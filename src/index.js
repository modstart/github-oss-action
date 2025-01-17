const core = require('@actions/core');
const github = require('@actions/github');
const OSS = require('ali-oss');
const fs = require('fs');
const {resolve} = require('path');
const fg = require('fast-glob');
const path = require('path');
const axios = require('axios');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

const formatSize = (size) => {
    if (size < 1024) {
        return size + 'B';
    } else if (size < 1024 * 1024) {
        return (size / 1024).toFixed(2) + 'KB';
    } else if (size < 1024 * 1024 * 1024) {
        return (size / 1024 / 1024).toFixed(2) + 'MB';
    } else {
        return (size / 1024 / 1024 / 1024).toFixed(2) + 'GB';
    }
}

(async () => {
    try {
        const title = core.getInput('title')
        // OSS 实例化
        const opts = {
            accessKeyId: core.getInput('key-id'),
            accessKeySecret: core.getInput('key-secret'),
            bucket: core.getInput('bucket')
        };
        const callback = core.getInput('callback');
        const callbackUrlExpire = core.getInput('callbackUrlExpire');
        let successUrls = [];

        ;['region', 'endpoint']
            .filter(name => core.getInput(name))
            .forEach(name => {
                Object.assign(opts, {
                    [name]: core.getInput(name)
                })
            })

        const oss = new OSS(opts)

        // 上传资源
        const assets = core.getInput('assets', {required: true})

        const timeout = core.getInput('timeout')
        const uploadParam = {
            timeout: 1000 * Number(timeout)
        }

        const uploadOneFile = async (localPath, desc) => {
            let checkpoint = null;
            let lastPercentage = null;
            for (let i = 0; i < 5; i++) {
                try {
                    core.info(`upload ${localPath} to ${desc}`)
                    const result = await oss.multipartUpload(desc, resolve(localPath), {
                        checkpoint,
                        async progress(percentage, cpt) {
                            checkpoint = cpt;
                            percentage = parseInt(percentage * 100);
                            if (lastPercentage !== percentage) {
                                core.info(`upload progress: ${percentage}%`);
                                lastPercentage = percentage;
                            }
                        },
                    });
                    core.info('upload success')
                    break;
                } catch (e) {
                    core.error(e);
                    core.setFailed(e.message)
                }
            }
        }

        for (let rule of assets.split('\n')) {
            const [src, dst] = rule.split(':')
            const files = fg.sync([src], {dot: false, onlyFiles: true})
            core.info(`glob for rule: ${rule} - ${JSON.stringify(files)}`)
            if (!files.length) {
                continue;
            }
            if (/\/$/.test(dst)) {
                for (let file of files) {
                    const filename = path.basename(file)
                    await uploadOneFile(file, `${dst}${filename}`)
                    successUrls.push({
                        name: filename,
                        path: `${dst}${filename}`,
                        size: fs.statSync(file).size
                    })
                }
            } else {
                await uploadOneFile(files[0], dst)
                successUrls.push({
                    name: path.basename(files[0]),
                    path: dst,
                    size: fs.statSync(files[0]).size
                })
            }
        }

        if (callback && successUrls.length > 0) {
            core.info(`callback for : ${successUrls.length} urls`)
            let postData = {}
            if (title) {
                postData['title'] = title
            }
            successUrls.forEach((url, index) => {
                const key = [
                    url.name,
                    `(${formatSize(url.size)})`,
                ].join('')
                postData[key] = oss.signatureUrl(url.path, {
                    expires: callbackUrlExpire
                })
            })
            // GET callback with data = {successUrls}
            const res = await axios.get(callback, {
                params: {
                    data: JSON.stringify(postData)
                },
                proxy: false
            })
            core.info(`callback response: ${res.status} ${res.statusText} ${JSON.stringify(res.data)}`)
        }

    } catch (err) {
        core.setFailed(err.message)
    }
})()

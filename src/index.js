const core = require('@actions/core');
const github = require('@actions/github');
const OSS = require('ali-oss');
const fs = require('fs');
const { resolve } = require('path');
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

// Generate random string for placeholder
const generateRandomString = (length = 8) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Replace placeholders in template string
const replacePlaceholders = (template, fileName, randomStr) => {
    const nameWithoutExt = path.parse(fileName).name;
    return template
        .replace(/{random}/g, randomStr)
        .replace(/{name}/g, nameWithoutExt);
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
        const callbackUrlSign = core.getInput('callbackUrlSign');
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
        const assets = core.getInput('assets', { required: true })

        const timeout = core.getInput('timeout')
        const uploadParam = {
            timeout: 1000 * Number(timeout)
        }

        const uploadOneFile = async (localPath, desc) => {
            let checkpoint = null;
            let lastPercentage = null;
            const size = fs.statSync(localPath).size
            const sizeFormatString = formatSize(size)
            for (let i = 0; i < 5; i++) {
                try {
                    core.info(`upload ${localPath} to ${desc}`)
                    const result = await oss.multipartUpload(desc, resolve(localPath), {
                        checkpoint,
                        async progress(percentage, cpt) {
                            checkpoint = cpt;
                            const uploadedSize = size * percentage;
                            percentage = parseInt(percentage * 100);
                            if (lastPercentage !== percentage) {
                                core.info(`upload progress: ${percentage}%（${formatSize(uploadedSize)}/${sizeFormatString}）`);
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
            const parts = rule.split(':')
            const src = parts[0]
            const dstTemplate = parts[1]
            const forceDownloadNameTemplate = parts[2] || null  // Third part for force download name

            const files = fg.sync([src], { dot: false, onlyFiles: true })
            core.info(`glob for rule: ${rule} - ${JSON.stringify(files)}`)
            if (!files.length) {
                continue;
            }
            if (/\/$/.test(dstTemplate)) {
                // Directory destination (ends with /)
                for (let file of files) {
                    const filename = path.basename(file)
                    const randomStr = generateRandomString()
                    const dst = replacePlaceholders(dstTemplate, filename, randomStr)
                    let forceDownloadName = forceDownloadNameTemplate
                    if (forceDownloadNameTemplate) {
                        forceDownloadName = replacePlaceholders(forceDownloadNameTemplate, filename, randomStr)
                    }
                    await uploadOneFile(file, `${dst}${filename}`)
                    successUrls.push({
                        name: filename,
                        path: `${dst}${filename}`,
                        size: fs.statSync(file).size,
                        forceDownloadName: forceDownloadName
                    })
                }
            } else {
                // File destination or template with placeholders
                for (let file of files) {
                    const filename = path.basename(file)
                    const randomStr = generateRandomString()
                    const dst = replacePlaceholders(dstTemplate, filename, randomStr)
                    let forceDownloadName = forceDownloadNameTemplate
                    if (forceDownloadNameTemplate) {
                        forceDownloadName = replacePlaceholders(forceDownloadNameTemplate, filename, randomStr)
                    }
                    await uploadOneFile(file, dst)
                    successUrls.push({
                        name: filename,
                        path: dst,
                        size: fs.statSync(file).size,
                        forceDownloadName: forceDownloadName
                    })
                }
            }
        }

        // Build download URL map and expose as output (regardless of callback)
        if (successUrls.length > 0) {
            core.info(`generating download urls for ${successUrls.length} files`);
            let postData = {};
            if (title) {
                postData['title'] = title;
            }
            successUrls.forEach((url) => {
                const key = [
                    url.name,
                    `(${formatSize(url.size)})`,
                ].join('');
                if (callbackUrlSign === 'true' || url.forceDownloadName) {
                    const signOptions = {
                        expires: callbackUrlExpire
                    };
                    if (url.forceDownloadName) {
                        signOptions.response = {
                            'content-disposition': `attachment; filename="${encodeURIComponent(url.forceDownloadName)}"`
                        };
                    }
                    postData[key] = oss.signatureUrl(url.path, signOptions);
                } else {
                    postData[key] = oss.generateObjectUrl(url.path);
                }
            });

            // Expose downloads map as a masked output for downstream jobs
            const downloadsJson = JSON.stringify(postData);
            core.setSecret(downloadsJson);
            core.setOutput('downloads', downloadsJson);

            // Callback (existing behavior)
            if (callback) {
                core.info(`callback for : ${successUrls.length} urls`);
                const params = {
                    data: JSON.stringify(postData)
                };
                const callbackTitle = core.getInput('callbackTitle');
                if (callbackTitle) {
                    params.title = callbackTitle;
                }
                const res = await axios.get(callback, {
                    params: params,
                    headers: {
                        'User-Agent': 'github-oss-action',
                    },
                    proxy: false
                });
                core.info(`callback response: ${res.status} ${res.statusText} ${JSON.stringify(res.data)}`);
            }
        }

    } catch (err) {
        core.setFailed(err.message)
    }
})()

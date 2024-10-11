const core = require('@actions/core');
const github = require('@actions/github');
const OSS = require('ali-oss');
const fs = require('fs');
const {resolve} = require('path');
const fg = require('fast-glob');

(async () => {
    try {
        // OSS 实例化
        const opts = {
                accessKeyId: core.getInput('key-id'),
                accessKeySecret: core.getInput('key-secret'),
                bucket: core.getInput('bucket')
            }

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
                    core.info(`Upload ${localPath} to ${desc}`)
                    const result = await oss.multipartUpload(desc, resolve(localPath), {
                        checkpoint,
                        async progress(percentage, cpt) {
                            checkpoint = cpt;
                            percentage = parseInt(percentage * 100);
                            if (lastPercentage !== percentage) {
                                core.info(`Upload Progress: ${percentage}%`);
                                lastPercentage = percentage;
                            }
                        },
                    });
                    core.info('Upload success')
                    break;
                } catch (e) {
                    core.error(e);
                    core.setFailed(e.message)
                }
            }
        }

        assets.split('\n')
            .forEach(async rule => {
                const [src, dst] = rule.split(':')
                const files = fg.sync([src], {dot: false, onlyFiles: true})
                if (files.length && !/\/$/.test(dst)) {
                    await uploadOneFile(files[0], dst)
                } else if (files.length && /\/$/.test(dst)) {
                    await Promise.all(files.map(async file => {
                        const base = src.replace(/\*+$/g, '')
                        const filename = file.replace(base, '')
                        await uploadOneFile(file, `${dst}${filename}`)
                    }))
                }
            })

    } catch (err) {
        core.setFailed(err.message)
    }
})()

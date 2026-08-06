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
        // Convert seconds to ms; fallback to 3600s if input is missing/empty
        const timeoutMs = 1000 * Number(timeout || 3600)

        const uploadOneFile = async (localPath, desc) => {
            let checkpoint = null;
            let lastPercentage = null;
            const size = fs.statSync(localPath).size
            const sizeFormatString = formatSize(size)
            let lastError = null;
            for (let i = 0; i < 5; i++) {
                try {
                    core.info(`upload ${localPath} to ${desc}`)
                    await oss.multipartUpload(desc, resolve(localPath), {
                        timeout: timeoutMs,
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
                    return;
                } catch (e) {
                    lastError = e;
                    const resumeHint = checkpoint ? ', will resume from checkpoint on next attempt' : '';
                    core.warning(`upload attempt ${i + 1}/5 failed: ${e.message}${resumeHint}`);
                }
            }
            // All attempts failed: signal failure so the caller does NOT
            // treat the file as uploaded and does NOT fire the callback.
            throw lastError;
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

        // Build download URL maps
        if (successUrls.length > 0) {
            core.info(`generating download urls for ${successUrls.length} files`);
            // postData includes size in key (for callback, existing behavior)
            let postData = {};
            // downloadData uses bare filename as key (for workflow output)
            let downloadData = {};
            if (title) {
                postData['title'] = title;
            }
            successUrls.forEach((url) => {
                const signedUrl = oss.signatureUrl(url.path, {
                    expires: callbackUrlExpire,
                    ...(url.forceDownloadName ? {
                        response: {
                            'content-disposition': `attachment; filename="${encodeURIComponent(url.forceDownloadName)}"`
                        }
                    } : {})
                });
                // Key with size (for callback)
                const keyWithSize = [
                    url.name,
                    `(${formatSize(url.size)})`,
                ].join('');
                postData[keyWithSize] = signedUrl;
                // Key without size (for workflow downloads output)
                downloadData[url.name] = signedUrl;
            });

            // Expose downloads map (bare filenames) as masked output + artifact source
            const downloadsJson = JSON.stringify(downloadData);
            core.setSecret(downloadsJson);
            core.setOutput('downloads', downloadsJson);

            // Callback (existing behavior, uses postData with size in keys)
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

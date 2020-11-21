
const path = require('path');
const fs = require('fs-extra');
const concatFiles = require('concat-files');
const { IncomingForm } = require('formidable');

let UPLOAD_BASE_DIR;        // 文件上传存储目录
let UPLOAD_BASE_DIR_TMP;    // 文件上传切片暂存位置

// 获取目录下的所有文件（除了mac的 .DS_Store)
function getChunkList (dirPath) {
    const list = fs.readdirSync(dirPath, 'utf-8');
    if (list && list.length) {
        return list.filter(fn => fn !== '.DS_Store');
    }
    return [];
}

// 合并文件
function mergeFiles (sourceDir, desFilePath) {
    return new Promise((resolve, reject) => {
        const files = getChunkList(sourceDir).map(fn => path.join(sourceDir, fn));
        concatFiles(files, desFilePath, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

// 查询文件hash是否存在 -> 存在则同时返回已经上传的所有分片chunkList
async function checkFileHashExist (ctx) {
    const { hash } = ctx.query || {};
    const fileHashDirPath = path.join(UPLOAD_BASE_DIR, hash);
    if (fs.existsSync(fileHashDirPath)) {
        ctx.body = {
            errCode: '000000',
            errMsg: 'sucess',
            data: {
                exists: true,
                chunkList: getChunkList(fileHashDirPath)
            }
        }
    } else {
        ctx.body = {
            errCode: '000000',
            errMsg: 'sucess',
            data: {
                exists: false
            }
        }
    }
}

// 上传文件单个分片chunk
async function uploadChunk (ctx) {
    return new Promise((resolve, reject) => {
        const form = IncomingForm({ uploadDir: UPLOAD_BASE_DIR_TMP });

        form.parse(ctx.req, (err, fields, file) => {
            if (err) {
                ctx.body = {
                    errCode: '000002',
                    errMsg: err.message
                };
                reject(err);
            }

            const { hash, index } = fields;
            const desDirPath = path.join(UPLOAD_BASE_DIR, hash);
            const desFilePath = path.join(desDirPath, index);
            try {
                fs.ensureDir(desDirPath);
                fs.copyFileSync(file.data.path, desFilePath);
                fs.rmSync(file.data.path);

                ctx.body = {
                    errCode: '000000',
                    errMsg: 'upload sucess',
                    data: index
                };

            } catch (err) {
                ctx.body = {
                    errCode: '000003',
                    errMsg: err.message
                };
            }

            resolve();
        });

    })
}

// 通知上传完毕, 进行合并
async function uploadFinish (ctx) {
    const { hash, filename } = ctx.query;
    const sourceDir = path.join(UPLOAD_BASE_DIR, hash);
    const desFilePath = path.join(UPLOAD_BASE_DIR, filename);

    // TODO: check filename/hash
    try {
        await mergeFiles(sourceDir, desFilePath);
        fs.rmdirSync(sourceDir, { recursive: true });
        ctx.body = {
            errCode: '000000',
            errMsg: 'file merge sucess'
        }
    } catch(err) {
        console.log(err);
        ctx.body = {
            errCode: '000001',
            errMsg: `file merge fail: ${err.message}`
        }
    }
}

/**
 * 
 * @param {*} options 
 *  prefix  (default: upload)
 *  uploadDir (default: upload)
 */
module.exports = function (options) {
    const { 
        prefix = 'upload',
        uploadDir = 'upload'
    } = options || {};

    UPLOAD_BASE_DIR = uploadDir;
    UPLOAD_BASE_DIR_TMP = path.join(UPLOAD_BASE_DIR, 'tmp');
    fs.ensureDirSync(UPLOAD_BASE_DIR);
    fs.ensureDirSync(UPLOAD_BASE_DIR_TMP);

    const reqPathMap = {
        [`/${prefix}/checkFileHashExist`]: checkFileHashExist,
        [`/${prefix}/uploadChunk`]: uploadChunk,
        [`/${prefix}/uploadFinish`]: uploadFinish,
    };

    return async function (ctx, next) {
        if (reqPathMap[ctx.path]) {
            await reqPathMap[ctx.path](ctx);
        }
        await next();
    }
};
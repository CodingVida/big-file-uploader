
import SparkMD5 from 'spark-md5';

function _ajax (options) {
    const { method = 'GET', url, data } = options;
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, url);
        xhr.send(data);
        xhr.onreadystatechange = (e) => {
            const { readyState, status, statusText } = xhr;
            if(readyState === XMLHttpRequest.DONE) {
                if (status === 200) {
                    try {
                        const { errCode, errMsg, data } = JSON.parse(xhr.responseText);
                        if (errCode === '000000') {
                            resolve(data);
                        } else {
                            reject(new Error(errMsg));
                        }
                    } catch (err) {
                        reject(err);
                    }
                } else {
                    reject(new Error(statusText));
                }
            }
        };
    });
}

function BigFileUploader (file, { chunkSize = 1024, prefix = 'upload' } = {}) {
    if (!(file instanceof File)) {
        throw new Error('arguments `file` must be File instance');
    }
    
    this.file = file;
    this.chunkSize = chunkSize;
    this.chunkCount = 0;
    this.prefix = prefix;
    this.filename = file.name;
    this.fileHash = '';
    this.exists = [];

    this.reqPathMap = {
        checkFileHash: `${prefix}/checkFileHashExist`,
        uploadChunk: `${prefix}/uploadChunk`,
        notifyFinish: `${prefix}/uploadFinish`
    };

    this.events = {};

    this.uplaod();
}

BigFileUploader.prototype.uplaod = async function () {
    try {
        this.emit('begin');
        // 获取文件hash
        this.fileHash = await this.getFileHash();

        // 检查是否已有一部分片段上传上去了: 断点续传。
        const { exists, chunkList } = await this.checkFileHash();
        if (exists) {
            this.exists = chunkList;
        }
        // 开始上传
        await this.uploadFileHelper();

         // 通知上传成功
        await this.notifyFinish();

    } catch (err) {
        // console.log(err);
        this.emit('error', err);
    }
}

// 获取文件hash
BigFileUploader.prototype.getFileHash = async function () {
    const file = this.file;
    return new Promise((resolve, reject) => {
        const hashChunkCount = 100;
        const chunkSize = file.size / 100;
        const spark = new SparkMD5.ArrayBuffer();
        const fileReader = new FileReader();
        let currentChunk = 0;

        fileReader.onload = (e) => {
            spark.append(e.target.result);
            currentChunk++;

            // console.log(`read file chunk: ${currentChunk}`);
            this.emit('hashProgress', currentChunk);    //  hash生成处理过程通知

            if (currentChunk < hashChunkCount) {
                loadNext();
            } else {
                resolve(spark.end());
            }
        }
        fileReader.onerror = reject;

        function loadNext () {
            const start = currentChunk * chunkSize;
            const end = (start > file.size) ? file.size : (start + chunkSize);
            fileReader.readAsArrayBuffer(file.slice(start, end));
        }

        loadNext();
    });
}

// 检查是否已有一部分片段上传上去了
BigFileUploader.prototype.checkFileHash = async function () {
    const { reqPathMap: { checkFileHash }, fileHash } = this;
    const checkUrl = `${checkFileHash}?hash=${fileHash}`;
    return await _ajax({ url: checkUrl });
}

// 上传片段
BigFileUploader.prototype.uploadFileHelper = async function () {
    const { reqPathMap: { uploadChunk }, file, chunkSize, fileHash, exists } = this;
    const chunkCount = this.chunkCount = Math.ceil(file.size / chunkSize);
    async function upload (i) {
        const _end = (i + 1) * chunkSize
        const end = _end > file.size ? file.size : _end;
        const form = new FormData();
        form.append('data', file.slice(i * chunkSize, end));
        form.append('hash', fileHash);
        form.append('index', i);
        form.append('total', chunkCount);
        return await _ajax({
            method: 'POST',
            url: uploadChunk,
            data: form
        });
    }

    for (let i = 0; i < chunkCount; i++) {
        if (!exists.includes(i + '')) {
            try {
                await upload(i, file);
                this.emit('uploadProgress', i + 1);     // 第 i 个chunk上传成功。
            } catch (err) {
                throw err;
            }
        }
    }
}

// 通知完成
BigFileUploader.prototype.notifyFinish = async function () {
    const { reqPathMap: { notifyFinish }, filename, fileHash } = this;
    const url = `${notifyFinish}?hash=${fileHash}&filename=${filename}`;
    try {
        await _ajax({ url });
        this.emit('finish');
    } catch (err) {
        throw err;
    }
}

// 事件监听
BigFileUploader.prototype.on = function (name, fn) {
    if (!this.events[name]) {
        this.events[name] = [];
    }
    this.events[name].push(fn);
}

BigFileUploader.prototype.off = function (name, fn) {
    const eventQueue = this.events[name];
    if (eventQueue) {
        this.events[name] = eventQueue.filter(f => fn !== f);
    }
}

BigFileUploader.prototype.emit = function (name, data) {
    const eventQueue = this.events[name];
    if (eventQueue) {
        eventQueue.forEach(fn => {
            fn(data);
        });
    }
}

export default BigFileUploader;
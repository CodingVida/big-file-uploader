
const path = require('path');

module.exports = {
    mode: 'production',
    entry: './index.js',
    output: {
        path: path.join(__dirname, 'dist'),
        filename: 'big-file-uploader.js',
        globalObject: 'this',
        library: 'BigFileUploader',
        libraryTarget: 'umd',
        libraryExport: 'default'
    }
}
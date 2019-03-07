const Client = require('ftp');
const fs = require('fs');
const path = require('path');
const async = require('async');
// log4js.configure({
//   appenders: { cheese: { type: 'file', filename: `${__dirname}/pack.log` } },
//   categories: { default: { appenders: ['pack'], level: 'info' } }
// });
// const logger = log4js.getLogger('pack');


module.exports = (options, modified, total, callback) => {
    options.remoteDir = options.remoteDir || '/';
    let ftpCache = fileCache(options),

        files = modified.length == 0 ? total : modified,
        fileCount = files.length,

        uploadFiles = options.cache ? ftpCache.filter(files) : files,
        uploadTotal = uploadFiles.length,

        userOptions = options;

    fis.time('\n compile cost');

    // 如果总需要上传文件为0 则直接结束
    if (uploadTotal == 0) {
        cb('没有变更文件, 请检查catch文件是否需要删除!');
        return;
    } else {
        let client = new Client();
        client.connect(options.connect);

        // 链接准备就绪
        client.on('ready', () => {
            let errorList = [];
            console.log(uploadFiles.length +'个文件需要打包上传!');
            console.log('------------------------------------------------------------->')
            async.mapLimit(uploadFiles, 1, (file, uploadCallback) => {
                let dest = file.getHashRelease();
                dest = path.join(options.remoteDir, file.subpath).replace(/\\/g, '/');
                dest = dest.replace(file.basename, file.filename + '_' + file.getHash() + file.ext);

                client.put(new Buffer(file.getContent()), dest, function (err) {
                    if (err) {
                        errorList.push(file);
                        console.log('\n -' + dest + ' 上传失败!');
                    } else {
                        console.log('\n -' + dest + ' 上传成功!');
                    }
                    uploadCallback(null, file);
                });

            }, (err, data) =>{
                console.log('------------------------------------------------------------->')
                if (errorList.length > 0){
                    console.log(uploadFiles.length - errorList.length +'个文件打包上传成功!');
                    console.log(errorList.length +'个文件打包上传失败, 正在尝试重新上传...');
                    reUpload(errorList, callback);
                } else {
                    console.log(uploadFiles.length +'个文件打包上传成功!');
                    client.end();
                    callback();
                }
            });
        });

        client.on('greeting', msg => {
            console.log(msg);
        })
        
        
        client.on('error', (err) => {
            console.log(err);
        })


    }
}

/**
 * 缓存文件信息
 *
 */
module.exports.fileCache = fileCache = (opts) => {
    let gitHEAD = fs.readFileSync(path.join(fis.project.getProjectPath(), opts.rootDir, '.git/HEAD'), 'utf-8').trim() // ref: refs/heads/develop
    let ref = gitHEAD.split(': ')[1] // refs/heads/develop
    let gitBranchName = gitHEAD.split('/')[2] // 环境：eg:develop


    let tmpPath = fis.project.getProjectPath() + path.sep + 'fis3_deploy_ftp' + path.sep + parsePath(opts.connect.host + ':' + opts.connect.port),
        jsonPath = tmpPath + path.sep + parsePath(opts.remoteDir) + gitBranchName + '_sourcemap.json',
        defaultPath = tmpPath + path.sep + parsePath(opts.remoteDir) + 'master_sourcemap.json';

    // fis.log.debug('tmpPath: %s', jsonPath);

    let cache = {};
    if (fis.util.isFile(jsonPath)) {
        if (opts.cache) {
            cache = fis.util.readJSON(jsonPath);
        } else {
            fis.util.del(jsonPath);
        }
    } else if (fis.util.isFile(defaultPath)) {
        if (opts.cache) {
            cache = fis.util.readJSON(defaultPath);
        }
    }

    function filter(files) {
        let result = [];
        files.forEach(function (file) {
            let id = file.getId(),
                hash = file.getHash();

            // fis.log.debug('%s : %s', id, hash);
            if (!cache[id] || cache[id] != hash) {
                cache[id] = hash;
                result.push(file);
            }
        });

        if (result.length > 0) save();

        return result;
    }

    function parsePath(path) {
        if (!path) return '';
        return path.replace(/^\/+/, '').replace(/\/\/(.*):(.*)@/, '').replace(/[:\/\\\.-]+/g, '_');
    }

    function save() {
        fis.util.write(jsonPath, JSON.stringify(cache,null,4));
    }

    return {
        filter: filter
    };
}

/***
 * 遍历文件信息
 *
 */
module.exports.resolveDir = resolveDir = (dirname, cb, dest) => {
    if (remoteDirCache[dirname]) {
        cb(false, remoteDirCache[dirname]);
        return;
    }

    let listRemote = function () {
        let queues = resolveing[dirname] || (resolveing[dirname] = []);
        if (queues.length) {
            queues.push(cb);
        } else {
            queues.push(cb);

            let listFileCallback = function (err, list) {
                if (err) {
                    ftpQueue && ftpQueue.destroy();
                    ftpQueue = createFtpQueue(userOptions);
                    ftpQueue.listFiles(dirname, listFileCallback);
                    return;
                }

                let fn = function () {
                    remoteDirCache[dirname] = true;
                    delete resolveing[dirname];
                    queues.forEach(function (cb) {
                        cb(list);
                    });
                };

                if (!list || list.length == 0) {
                    ftpQueue.addDir(dirname, fn);
                } else {
                    fn();
                }
            };

            ftpQueue.listFiles(dirname, listFileCallback);
        }
    }

    if (~dirname.indexOf(path.sep) && path.dirname(dirname) !== dirname) {
        resolveDir(path.dirname(dirname), listRemote, dest);
    } else {
        listRemote();
    }
}

/**
 * 配置信息
 *
 */
module.exports.options = {
    remoteDir: '/',
    cache: true,
    console: false,
    rootDir: '',
    connect: {
        host: '127.0.0.1',
        port: '21',
        secure: false,
        user: 'name',
        password: '****',
        secureOptions: undefined,
        connTimeout: 30000,
        pasvTimeout: 10000,
        keepalive: 60000,
    },
    limit: 5
};

/**
 * 输出信息到控制台
 *
 */
module.exports.cb = cb = (info) => {
    process.stdout.write(
        '\n FTP:'.green.bold + info
    );
}


module.exports.reUpload = reUpload = (uploadFiles, callback) => {
    let client = new Client();
    client.connect(options.connect);

    // 链接准备就绪
    client.on('ready', () => {
        let errorList = [];
        async.mapLimit(uploadFiles, 1, (file, uploadCallback) => {
            let dest = file.getHashRelease();
            dest = path.join(options.remoteDir, file.subpath).replace(/\\/g, '/');
            client.put(new Buffer(file.getContent()), dest, function (err) {
                if (err) {
                    errorList.push(file);
                    console.log('\n -' + dest + ' 上传失败!');
                } else {
                    console.log('\n -' + dest + ' 上传成功!');
                }
                uploadCallback(null, file);
            });

        }, (err, data) =>{
            console.log('\n ------------------------------------------------------------->')
            if (errorList.length > 0){
                console.log(uploadFiles.length - errorList.length +'个文件重新打包打包上传成功!');
                console.log(errorList.length +'个文件打包重新上传失败, 请手动重新打包');
                client.end();
            } else {
                console.log(uploadFiles.length +'个文件重新打包上传成功!');
                client.end();
                callback();
            }
        });
    });
}
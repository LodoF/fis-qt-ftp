const Client = require('ftp');
const fs = require('fs');
const path = require('path');
const async = require('async');

let client = null;

module.exports = (options, modified, total, callback) => {
    options.remoteDir = options.remoteDir || '/';
    let ftpCache = fileCache(options),

        files = modified.length == 0 ? total : modified,
        fileCount = files.length,

        uploadFiles = options.cache ? ftpCache.filter(files) : files,
        uploadTotal = uploadFiles.length,
        uploadCount = 0;
        userOptions = options;

    fis.time('\n compile cost');

    // 如果总需要上传文件为0 则直接结束
    if (uploadTotal == 0) {
        cb('没有变更文件, 请检查catch文件是否需要删除!');
        return;
    } else {
        client = new Client();
        client.connect(options.connect);

        // 链接准备就绪
        client.on('ready', () => {
            let errorList = [];
            cg(uploadFiles.length +'个文件需要打包上传!');
            cg('------------------------------------------------------------->')
            async.mapLimit(uploadFiles, 1, (file, uploadCallback) => {
                let dest = file.getHashRelease();
                dest = path.join(options.remoteDir, file.subpath).replace(/\\/g, '/');
                if (file.ext === '.css' || file.ext === '.js')
                  dest = dest.replace(file.basename, file.filename + '_' + file.getHash() + file.ext);

                uploadCount++;
                client.put(new Buffer(file.getContent()), dest, function (err) {
                    if (err) {
                        errorList.push(file);
                        cg('\n -'+ uploadCount + '--> ' + dest + ' 上传失败!');
                        uploadCallback(null, file);
                    } else {
                        cg('\n -'+ uploadCount + '--> '  + dest + ' 上传成功!');
                        uploadCallback(null, file);
                    }
                });
            }, (err, data) =>{
                cg('------------------------------------------------------------->')
                if (errorList.length > 0){
                    cg(uploadFiles.length - errorList.length +'个文件打包上传成功!');
                    cg(errorList.length +'个文件打包上传失败, 正在尝试重新上传...');
                    reUpload(errorList, options, callback);
                } else {
                    cg(uploadFiles.length +'个文件打包上传成功!');
                    client.end();
                    callback();
                }
            });
        });

        client.on('error', (err) => {
            cg(err);
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

/**
 * 控制台输出 console
 * @param {String} info 
 */
const cg = (info) => {
  console.log(info);
}


/**
 * 重试打包
 * 
 */
module.exports.reUpload = reUpload = (uploadFiles, options, callback) => {
    let errorList = [];
    uploadCount = 0;
    async.mapLimit(uploadFiles, 1, (file, uploadCallback) => {
      let dest = file.getHashRelease();
      dest = path.join(options.remoteDir, file.subpath).replace(/\\/g, '/');
      if (file.ext === '.css' || file.ext === '.js')
        dest = dest.replace(file.basename, file.filename + '_' + file.getHash() + file.ext);

      uploadCount ++;
      client.put(new Buffer(file.getContent()), dest, function (err) {
        if (err) {
            errorList.push(file);
            cg('\n -'+ uploadCount + '--> ' + dest + ' 重新上传失败!');
        } else {
            cg('\n -'+ uploadCount + '--> '  + dest + ' 重新上传成功!');
        }
        uploadCallback(null, file);
      });
    }, (err, data) =>{
        cg('\n ------------------------------------------------------------->')
        if (errorList.length > 0){
            cg(uploadFiles.length - errorList.length +'个文件重新打包打包上传成功!');
            cg(errorList.length +'个文件打包重新上传失败, 请手动重新打包');
            client.end();
        } else {
            cg(uploadFiles.length +'个文件重新打包上传成功!');
            client.end();
            callback();
        }
    });
}
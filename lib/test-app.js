var fs = require('fs');
var path = require('path');
var spawn = require('child_process').spawn;
var util = require('./util.js');


// 每 0.2 秒读取子进程的输出文件。
//
// 为什么不直接通过 child.stdout 读取？
// 因为如果使用 stdio pipe 的方式去开启子进程，当 master 进程退出后，子进程再有输出就会导致程序莫名的崩溃。
// 解决办法是，让子进程的输出直接指向文件指针。
// master 每隔一段时间去读文件，获取子进程输出。
function watchOnFile(filepath, callback) {
  var lastIndex = 0;
  var timer;

  function read() {
    var stat = fs.statSync(filepath);

    if (stat.size != lastIndex) {
      var fd = fs.openSync(filepath, 'r');
      var buffer = new Buffer(stat.size - lastIndex);

      try {
        fs.readSync(fd, buffer, lastIndex, stat.size - lastIndex);
        var content = buffer.toString('utf8');
        lastIndex = stat.size;

        callback(content);
      } catch (e) {
        // 从头读起
        lastIndex = 0;
      }
    }

    timer = setTimeout(read, 200);
  }

  read();
  return function() {
    clearTimeout(timer);
  };
}

exports.start = function(opt, callback) {
  script = path.join(__dirname, 'test-server.js');

  var timeout = Math.max(opt.timeout * 1000, 5000);
  var timeoutTimer;
  var args = [script];

  // 把 options 通过 args 传给 app 程序。
  fis.util.map(opt, function(key, value) {

    if (key === 'proxy') {
      args.push('--' + key, String(value?true:false));
    } else {
      args.push('--' + key, String(value));
    }
    
  });

  process.stdout.write('\n Starting fis-server .');
  var logFile = path.join(opt.root, 'server.log');
  var server = spawn(process.execPath, args, {
    cwd: path.dirname(script),
    detached: opt.daemon,
    stdio: [0, opt.daemon ? fs.openSync(logFile, 'w') : 'pipe', opt.daemon ? fs.openSync(logFile, 'w+') : 'pipe']
  });

  var log = '';
  var started = false;
  var error = false;
  var stoper;

  var onData = function(chunk) {
    if (started) {
      return;
    }

    chunk = chunk.toString('utf8');
    log += chunk;
    process.stdout.write('.');

    if (~chunk.indexOf('Error')) {
      if (error) {
        return;
      }

      error = true;
      process.stdout.write(' fail.\n');

      var match = chunk.match(/Error:?\s+([^\r\n]+)/i);
      var errMsg = 'unknown';

      if (~chunk.indexOf('EADDRINUSE')) {
        log = '';
        errMsg = 'Address already in use:' + opt.port;
      } else if (match) {
        errMsg = match[1];
      }

      log && console.log(log);
      stoper && stoper();

      try {
        callback(errMsg);
      } catch (e) {
        console.log(e);
      }

      // try {
      //   process.kill(server.pid, 'SIGKILL');
      // } catch (e) {}
    } else if (~chunk.indexOf('Listening on')) {
      started = true;
      stoper && stoper();
      clearTimeout(timeoutTimer);

      process.stdout.write(' at port [' + opt.port + ']\n');
      callback(null);
    }
  }

  if (opt.daemon) {
    stoper = watchOnFile(logFile, onData);
    util.pid(server.pid); // save pid to file.
    server.unref();

    timeoutTimer = setTimeout(function() {
      process.stdout.write(' fail\n');
      if (log) console.log(log);
      fis.log.error('timeout');
    }, timeout);
  } else {
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.stdout.pipe(process.stdout);
    server.stderr.pipe(process.stderr);
  }
};

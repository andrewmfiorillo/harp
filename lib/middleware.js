var path            = require('path')
var fs              = require('fs')
var helpers         = require('./helpers')
var mime            = require('mime')
var terraform       = require('terraform')
var pkg             = require('../package.json')
var skin            = require('./skin')
var connect         = require('connect')
var send            = require('send')
var utilsPause      = require('pause')
var utilsEscape     = require('escape-html')
var parse           = require('parseurl')
var url             = require('url')


/**
 * Opens the (optional) harp.json file and sets the config settings.
 */

exports.setup = function(req, rsp, next){
  if(req.hasOwnProperty('setup')) return next()

  try{
    req.setup = helpers.setup(req.projectPath)
  }catch(error){
    error.stack = helpers.stacktrace(error.stack, { lineno: error.lineno })

    var locals = {
      project: req.headers.host,
      error: error,
      pkg: pkg
    }

    return terraform.root(__dirname + "/templates").render("error.jade", locals, function(err, body){
      rsp.statusCode = 500
      rsp.end(body)
    })
  }

  next()
}


/**
 * Multihost Only: Renders an index page with the hosted projects
 *
 */

exports.index = function(dirPath){
  return function(req, rsp, next){
    // console.log('Middleware: Index: Called');

    var host      = req.headers.host;
    var url       = req.url;
    var poly      = terraform.root(__dirname + "/templates");

    if(url == '/'){
      // they're on the index page, display the projects index
      fs.readdir(dirPath, function(err, files){
        var projects = [];

        files.forEach(function(file){
          var appPart = file; // TODO: strip out bad characters?

          // DOT files and UNDERSCORED are ignored.
          if (!helpers.shouldIgnore(req.setup, file)) {
            projects.push({
              "name"      : file,
              "localUrl"  : 'http://' + host + '/' + appPart,
              "localPath" : path.resolve(file)
            });
          }
        });

        poly.render("index.jade", { pkg: pkg, projects: projects, layout: "_layout.jade" }, function(error, body){
          rsp.end(body)
        });
      })
    } else {
      next();
    }
  }
}

/**
 * Multihost only: Updates the req.projectPath attribute to match
 *
 */

exports.hostProjectFinder = function(dirPath){
  return function(req, rsp, next){
    var host        = req.headers.host;
    var url         = req.url;
    var matches     = [];

    fs.readdir(dirPath, function(err, files){
      var appPart = url.split("/")[1];
      files.forEach(function(file){
        if (appPart == file) { // TODO: strip bad characters?
          matches.push(file);
        }
      });

      if(matches.length > 0){
        req.projectPath = path.resolve(dirPath, matches[0]);
        next();
      } else {
        notFound(req, rsp, next);
      }

    });
  }
}

exports.regProjectFinder = function(projectPath){
  return function(req, rsp, next){
    // console.log('Middleware: regProjectFinder: Called');
    req.projectPath = projectPath
    next()
  }
}

/**
 * Fallbacks
 *
 * This is the logic behind rendering fallback files.
 *
 *  1. return static 200.html file
 *  2. compile and return 200.xxx
 *  3. return static 404.html file
 *  4. compile and return 404.xxx file
 *  5. default 404
 *
 * It is broken into two public functions `fallback`, and `notFound`
 *
 */

var fallback = exports.fallback = function(req, rsp, next){
  // console.log('Middleware: fallback: Called');
  skin(req, rsp, [custom200static, custom200dynamic, notFound], next)
}

var notFound = exports.notFound = function(req, rsp, next){
  // console.log('Middleware: notFound: Called');
  skin(req, rsp, [custom404static, custom404dynamic, default404], next)
}


/**
 * Custom 200
 *
 *  1. return static 200.html file
 *  2. compile and return 200.xxx file
 *
 */

var custom200static = function(req, rsp, next){
  // console.log('Middleware: custom200static: Called');
  fs.readFile(path.resolve(req.projectPath, "200.html"), function(err, contents){
    if(contents){
      var body    = contents.toString()
      var type    = helpers.mimeType("html")
      var charset = mime.charsets.lookup(type)
      rsp.setHeader('Content-Type', type + (charset ? '; charset=' + charset : ''))
      rsp.setHeader('Content-Length', Buffer.byteLength(body, charset));
      rsp.statusCode = 200
      rsp.end(body)
    }else{
      next()
    }
  })
}

/**
 * Custom 200 (jade, md, ejs)
 *
 *  1. return static 200.html file
 *  2. compile and return 404.xxx file
 *
 */

var custom200dynamic = function(req, rsp, next){
  // console.log('Middleware: custom200dynamic: Called');
  skin(req, rsp, [poly], function(){
    var priorityList  = terraform.helpers.buildPriorityList("200.html")
    var sourceFile    = terraform.helpers.findFirstFile(req.projectPath, priorityList)
    if(!sourceFile) return next()

    req.poly.render(sourceFile, function(error, body){
      if(error){
        // TODO: make this better
        rsp.statusCode = 404;
        rsp.end("There is an error in your " + sourceFile + " file")
      }else{
        if(!body) return next()
        var type    = helpers.mimeType("html")
        var charset = mime.charsets.lookup(type)
        rsp.setHeader('Content-Type', type + (charset ? '; charset=' + charset : ''));
        rsp.setHeader('Content-Length', Buffer.byteLength(body, charset));
        rsp.statusCode = 200;
        rsp.end(body)
      }
    })
  })
}


/**
 * Custom 404 (html)
 *
 *  1. return static 404.html file
 *  2. compile and return 404.xxx file
 *
 * TODO: cache readFile IO
 *
 */

var custom404static = function(req, rsp, next){
  // console.log('Middleware: custom404static: Called');
  fs.readFile(path.resolve(req.projectPath, "404.html"), function(err, contents){
    if(contents){
      var body    = contents.toString()
      var type    = helpers.mimeType("html")
      var charset = mime.charsets.lookup(type)
      rsp.setHeader('Content-Type', type + (charset ? '; charset=' + charset : ''))
      rsp.setHeader('Content-Length', Buffer.byteLength(body, charset));
      rsp.statusCode = 404
      rsp.end(body)
    }else{
      next()
    }
  })
}


/**
 * Custom 404 (jade, md, ejs)
 *
 *  1. return static 404.html file
 *  2. compile and return 404.xxx file
 *
 */

var custom404dynamic = function(req, rsp, next){
  // console.log('Middleware: custom404dynamic: Called');
  skin(req, rsp, [poly], function(){
    var priorityList  = terraform.helpers.buildPriorityList("404.html")
    var sourceFile    = terraform.helpers.findFirstFile(req.projectPath, priorityList)
    if(!sourceFile) return next()

    req.poly.render(sourceFile, function(error, body){
      if(error){
        // TODO: make this better
        rsp.statusCode = 404;
        rsp.end("There is an error in your " + sourceFile + " file")
      }else{
        if(!body) return next()
        var type    = helpers.mimeType("html")
        var charset = mime.charsets.lookup(type)
        rsp.setHeader('Content-Type', type + (charset ? '; charset=' + charset : ''));
        rsp.setHeader('Content-Length', Buffer.byteLength(body, charset));
        rsp.statusCode = 404;
        rsp.end(body)
      }
    })
  })
}


/**
 * Default 404
 *
 * No 200 nor 404 files were found.
 *
 */

var default404 = function(req, rsp, next){
  // console.log('Middleware: default404: Called');
  var locals = {
    project: req.headers.host,
    name: "Page Not Found",
    pkg: pkg
  }
  terraform.root(__dirname + "/templates").render("404.jade", locals, function(err, body){
    var type    = helpers.mimeType("html")
    var charset = mime.charsets.lookup(type)
    rsp.setHeader('Content-Type', type + (charset ? '; charset=' + charset : ''));
    rsp.statusCode = 404
    rsp.setHeader('Content-Length', Buffer.byteLength(body, charset));
    rsp.end(body)
  })
}


/**
 * Underscore
 *
 * Returns 404 if path contains beginning underscore
 *
 */
exports.underscore = function(req, rsp, next){
  // console.log('Middleware: underscore: Called');
  if(helpers.shouldIgnore(req.setup, req.url)){
    notFound(req, rsp, next)
  }else{
    next()
  }
}

/**
 * Modern Web Language
 *
 * Returns 404 if file is a precompiled
 *
 */
exports.mwl = function(req, rsp, next){
  // console.log('Middleware: mwl: Called');
  var ext = path.extname(req.url).replace(/^\./, '')
  req.originalExt = ext

  // This prevents the source files from being served, but also
  // has to factor in that in this brave new world, sometimes
  // `.html` (Handlebars, others), `.css` (PostCSS), and
  // `.js` (Browserify) are actually being used to specify
  // source files

  //if (['js'].indexOf(ext) === -1) {
    if (terraform.helpers.processors["html"].indexOf(ext) !== -1 || terraform.helpers.processors["css"].indexOf(ext) !== -1 || terraform.helpers.processors["js"].indexOf(ext) !== -1) {
      notFound(req, rsp, next)
    } else {
      next()
    }
  //} else {
    //next()
  //}
}

/**
 * Static
 *
 * Serves up static page (if it exists).
 *
 */
exports.static = function(req, res, next) {
  // console.log('Middleware: static: Called');
  var options  = {}
  var redirect = true

  if ('GET' != req.method && 'HEAD' != req.method) return next()
  //if (['js'].indexOf(path.extname(req.url).replace(/^\./, '')) !== -1) return next()

  var pathn = parse(req).pathname;
  var pause = utilsPause(req);

  function resume() {
    next();
    pause.resume();
  }

  function directory() {

    if (!redirect) return resume();
    var pathname = url.parse(req.originalUrl).pathname;
    res.statusCode = 301;
    res.setHeader('Location', pathname + '/');
    res.end('Redirecting to ' + utilsEscape(pathname) + '/');
  }

  function error(err) {
    if (404 == err.status){
      // look for implicit `*.html` if we get a 404
      return path.extname(err.path) === ''
        ? serve(pathn + ".html")
        : resume()
    }
    next(err);
  }

  var serve = function(pathn){
    send(req, pathn, {
        maxage: options.maxAge || 0,
        root: req.projectPath,
        hidden: options.hidden
      })
      .on('error', error)
      .on('directory', directory)
      .pipe(res)
  }
  serve(pathn)
}

/**
 * Basic Auth
 */

exports.basicAuth = function(req, rsp, next){
  // console.log('Middleware: basicAuth: Called');

  // default empty
  var creds = []

  // allow array
  if(req.setup.config.hasOwnProperty("basicAuth") && req.setup.config["basicAuth"] instanceof Array)
    creds = req.setup.config["basicAuth"]

  // allow string
  if(req.setup.config.hasOwnProperty("basicAuth") && typeof req.setup.config["basicAuth"] === 'string')
    creds = [req.setup.config["basicAuth"]]

  // move on if no creds
  if(creds.length === 0) return next()

  // use connect auth lib iterate over all creds provided
  connect.basicAuth(function(user, pass){
    return creds.some(function(cred){
      return cred === user + ":" + pass
    })
  })(req, rsp, next)
}

/**
 * Sets up the poly object
 */

var poly = exports.poly = function(req, rsp, next){
  // console.log('Middleware: poly: Called');
  if(req.hasOwnProperty("poly")) return next()

  try{
    // console.log("Poly: projectPath: " + req.projectPath);
    // console.log('Poly: globals: ' + req.setup.config.globals);
    req.poly = terraform.root(req.projectPath, req.setup.config.globals)
  }catch(error){
    error.stack = helpers.stacktrace(error.stack, { lineno: error.lineno })
    var locals = {
      project: req.headers.host,
      error: error,
      pkg: pkg
    }
    return terraform.root(__dirname + "/templates").render("error.jade", locals, function(err, body){
      rsp.statusCode = 500
      rsp.end(body)
    })
  }
  next()
}


/**
 * Asset Pipeline
 */

exports.process = function(req, rsp, next){
  // console.log('Middleware: process: Called');
  var normalizedPath  = helpers.normalizeUrl(req.url)
  var priorityList    = terraform.helpers.buildPriorityList(normalizedPath)
  var sourceFile      = terraform.helpers.findFirstFile(req.projectPath, priorityList)


  /**
   * We GTFO if we don't have a source file.
   */

  if(!sourceFile){
    if (path.basename(normalizedPath) === "index.html") {
      var pathAr = normalizedPath.split(path.sep); pathAr.pop() // Pop index.html off the list
      var prospectCleanPath       = pathAr.join("/")
      var prospectNormalizedPath  = helpers.normalizeUrl(prospectCleanPath)
      var prospectPriorityList    = terraform.helpers.buildPriorityList(prospectNormalizedPath)
      prospectPriorityList.push(path.basename(prospectNormalizedPath + ".html"))

      sourceFile = terraform.helpers.findFirstFile(req.projectPath, prospectPriorityList)

      if (!sourceFile) {
        return next()
      } else {
        // 301 redirect
        rsp.statusCode = 301
        rsp.setHeader('Location', prospectCleanPath)
        rsp.end('Redirecting to ' + utilsEscape(prospectCleanPath))
      }

    } else {
      return next()
    }
  } else {

    /**
     * Now we let terraform handle the asset pipeline.
     */

    req.poly.render(sourceFile, function(error, body){
      if(error){
        error.stack = helpers.stacktrace(error.stack, { lineno: error.lineno })

        var locals = {
          project: req.headers.host,
          error: error,
          pkg: pkg
        }
        if(terraform.helpers.outputType(sourceFile) == 'css'){
          var outputType = terraform.helpers.outputType(sourceFile)
          var mimeType   = helpers.mimeType(outputType)
          var charset    = mime.charsets.lookup(mimeType)
          var body       = helpers.cssError(locals)
          rsp.statusCode = 200
          rsp.setHeader('Content-Type', mimeType + (charset ? '; charset=' + charset : ''))
          rsp.setHeader('Content-Length', Buffer.byteLength(body, charset));
          rsp.end(body)
        }else{

          // Make the paths relative but keep the root dir.
          // TODO: move to helper.
          //
          // var loc = req.projectPath.split(path.sep); loc.pop()
          // var loc = loc.join(path.sep) + path.sep
          // if(error.filename) error.filename = error.filename.replace(loc, "")

          terraform.root(__dirname + "/templates").render("error.jade", locals, function(err, body){
            var mimeType   = helpers.mimeType('html')
            var charset    = mime.charsets.lookup(mimeType)
            rsp.statusCode = 500
            rsp.setHeader('Content-Type', mimeType + (charset ? '; charset=' + charset : ''))
            rsp.setHeader('Content-Length', Buffer.byteLength(body, charset));
            rsp.end(body)
          })
        }
      }else{
        // 404
        if(!body) return next()

        var outputType = terraform.helpers.outputType(sourceFile)
        var mimeType   = helpers.mimeType(outputType)
        var charset    = mime.charsets.lookup(mimeType)
        rsp.statusCode = 200
        rsp.setHeader('Content-Type', mimeType + (charset ? '; charset=' + charset : ''))
        rsp.setHeader('Content-Length', Buffer.byteLength(body, charset));
        rsp.end(body);
      }
    })
  }
}

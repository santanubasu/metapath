require('lazy-ass');
var check = require("check-more-types");
var Module = require("module");
var _ = require("underscore");
var pick = require("pick-require");
var pickUtil = pick("pick-require", "util.js");

var activeMetapaths = {};

// Require hijacking below is based on https://github.com/bahmutov/really-need

// these variables are needed inside eval _compile
/* jshint -W098 */
var runInNewContext = require('vm').runInNewContext;
var runInThisContext = require('vm').runInThisContext;
var path = require('path');

var _require = Module.prototype.require;
la(check.fn(_require), 'cannot find module require');
var _compile = Module.prototype._compile;
la(check.fn(_compile), 'cannot find module _compile');

function shouldBustCache(options) {
    la(check.object(options), 'missing options object', options);

    // allow aliases to bust cache
    return options.bust || options.bustCache;
}

function shouldFreeWhenDone(options) {
    la(check.object(options), 'missing options object', options);

    return ((check.has(options, 'keep') && !options.keep) ||
    (check.has(options, 'cache') && !options.cache));
}

function noop() {}

function logger(options) {
    return check.object(options) &&
    (options.debug || options.verbose) ? console.log : noop;
}

function argsToDeclaration(args) {
    la(check.object(args), 'expected args object', args);
    var names = Object.keys(args);
    return names.map(function (name) {
            var val = args[name];
            var value = check.fn(val) ? val.toString() : JSON.stringify(val);
            return 'var ' + name + ' = ' + value + ';';
        }).join('\n') + '\n';
}

function load(transform, module, filename) {
    la(check.fn(transform), 'expected transform function');
    la(check.object(module), 'expected module');
    la(check.unemptyString(filename), 'expected filename', filename);

    var fs = require('fs');
    var source = fs.readFileSync(filename, 'utf8');
    var transformed = transform(source, filename);
    if (check.string(transformed)) {
        module._compile(transformed, filename);
    } else {
        console.error('transforming source from', filename, 'has not returned a string');
        module._compile(source, filename);
    }
}

// options by filename
var tempOptions = {};

Module.prototype.require = function reallyNeedRequire(name, options) {
    options = options || {};

    var log = logger(options);
    log('really-need', arguments);
    log('called from file', this.filename);

    la(check.unemptyString(name), 'expected module name', arguments);
    la(check.unemptyString(this.filename), 'expected called from module to have filename', this);

    var nameToLoad;

    if (name in activeMetapaths) {
        nameToLoad = activeMetapaths[name];
    }
    else if (name.indexOf("metapath:///")!==0) {
        nameToLoad = Module._resolveFilename(name, this);
    }
    else {
        return {};
        // throw "Metapath could not be found in active set.";
    }

    tempOptions[nameToLoad] = options;

    if (shouldBustCache(options)) {
        log('deleting from cache before require', name);
        delete require.cache[nameToLoad];
    }

    log('calling _require', nameToLoad);

    var extension = '.js';
    var prevPre = Module._extensions[extension];
    if (check.fn(options.pre)) {
        log('using pre- function' + (options.pre.name ? ' ' + options.pre.name : ''));
        Module._extensions[extension] = load.bind(null, options.pre);
    }

    var result = _require.call(this, nameToLoad);
    log('_require result', result);

    if (check.fn(options.pre)) {
        Module._extensions[extension] = prevPre;
    }

    if (shouldFreeWhenDone(options)) {
        log('deleting from cache after loading', name);
        delete require.cache[nameToLoad];
    }

    return result;
};

var resolvedArgv;

// see Module.prototype._compile in
// https://github.com/joyent/node/blob/master/lib/module.js
var _compileStr = _compile.toString();
_compileStr = _compileStr.replace('self.require(path);', 'self.require.apply(self, arguments);');

/* jshint -W061 */
var patchedCompile = eval('(' + _compileStr + ')');

Module.prototype._compile = function (content, filename) {
    var options = tempOptions[filename] || {};
    var log = logger(options);

    if (check.has(options, 'args') && check.object(options.args)) {
        log('injecting arguments', Object.keys(options.args).join(','), 'into', filename);
        var added = argsToDeclaration(options.args);
        content = added + content;
    }

    var result = patchedCompile.call(this, content, filename);

    if (check.fn(options.post)) {
        log('transforming result' + (options.post.name ? ' ' + options.post.name : ''));

        var transformed = options.post(this.exports, filename);
        if (typeof transformed !== 'undefined') {
            log('transform function returned undefined, using original result');
            this.exports = transformed;
        }
    }

    if (shouldFreeWhenDone(options)) {
        log('deleting from cache after loading', filename);
        delete require.cache[filename];
    }
    return result;
};

var need = Module.prototype.require.bind(module.parent);
need.cache = require.cache;

module.exports = {
    require:need,
    setActive:function(active) {
        activeMetapaths = active;
    },
    import:function(dependency) {
        var callerDirname = pickUtil.getCallerDirname(1);
        var dependencyRoot = pickUtil.resolveDependencyRoot(dependency, callerDirname);
        return prefix(
            require(path.join(dependencyRoot, "metapath.js")),
            "",
            path.relative(callerDirname, dependencyRoot)+"/"
        );
    },
    from:function(target) {
        var paths = [];
        var prefixes = [];
        var callerDirname = pickUtil.getCallerDirname(1);
        var base;
        var pathPrefix;
        if (target.indexOf("/")!==-1) {
            base = target;
            pathPrefix = path.normalize(path.join(".", path.relative(callerDirname, base)));
        }
        else {
            base = pickUtil.resolveDependencyRoot(target, callerDirname);
            pathPrefix = path.relative(callerDirname, base);
        }
        return {
            add:function(path) {
                if (_.isArray(path)) {
                    [].push.apply(paths, path);
                }
                else {
                    paths.push(path);
                }
                return this;
            },
            to:function(prefix) {
                prefixes.push(prefix);
                return this;
            },
            compose:function() {
                return composeAll(paths.map(function(path) {
                    return composeAll(prefixes.map(function(prefix) {
                        return build(base, path, prefix, pathPrefix);
                    }));
                }));
            }
        }

    }
}

var build = module.exports.build = function(base, dir, keyPrefix, valuePrefix) {
    return prefix(buildFrom(base, path.join(base, dir)), keyPrefix, valuePrefix);
}

var buildFrom = module.exports.buildFrom = function(base, dir) {
    var glob = require("glob");
    dir = dir||base;
    var mappings = {};
    var files = glob.sync(dir+"/**/*")
    files.forEach(function(file) {
        mappings[path.join("/", path.relative(dir, file))] = path.normalize(path.join("/", path.relative(base, file)));
    });

    return mappings;
}

var compose = module.exports.compose = function(source, target) {
    if (_.isArray(source)) {
        return composeAll(source, target);
    }
    target = target||{};
    if (_.isString(source)) {
        return source;
    }
    for (var key in source) {
        if (key in target) {
            target[key] = compose(source[key], target[key]);
        }
        else {
            target[key] = compose(source[key], {});
        }
    }
    return target;
}

var composeAll = module.exports.composeAll = function(sources, target) {
    target = target||{};
    sources.forEach(function(source) {
        target = compose(source, target);
    });
    return target;
}

var prefix = module.exports.prefix = function(metapath, keyPrefix, valuePrefix) {
    valuePrefix = valuePrefix||"";
    var prefixedMetapath = {};
    for (var key in metapath) {
        prefixedMetapath[keyPrefix+key] = path.normalize(valuePrefix+metapath[key]);
    }
    return prefixedMetapath;
}

var replace = module.exports.replace = function(source, metapaths) {
    return source.replace(/"(\s*metapath:\/\/[^"]+)"/g, function(match, path) {
        if (path in metapaths) {
            return "\""+metapaths[path]+"\"";
        }
        else {
            console.log("Unable to resolve metapath: "+path);
            return "\""+path+"\"";
        }
    })
}
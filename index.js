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
var _compile = Module.prototype._compile;

function noop() {}

function logger(options) {
    return check.object(options) &&
    (options.debug || options.verbose) ? console.log : noop;
}

function argsToDeclaration(args) {
    var names = Object.keys(args);
    return names.map(function (name) {
            var val = args[name];
            var value = check.fn(val) ? val.toString() : JSON.stringify(val);
            return 'var ' + name + ' = ' + value + ';';
        }).join('\n') + '\n';
}

function load(transform, module, filename) {
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

Module.prototype.require = function(name, options) {

    options = options||{};

    if (options.metapaths) {
        activeMetapaths = options.metapaths;
    }

    var nameToLoad;

    if (name in activeMetapaths) {
        nameToLoad = activeMetapaths[name];
    }
    else if (name.indexOf("metapath:///")!==0) {
        nameToLoad = Module._resolveFilename(name, this);
    }
    else {
        if (options.default) {
            return options.default
        }
        else {
            throw "Metapath could not be found in active set.";
        }
    }

    var extension = '.js';
    var prevPre = Module._extensions[extension];

    var result = _require.call(this, nameToLoad);

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
    var result = patchedCompile.call(this, content, filename);
    return result;
};

var metapathRequire = Module.prototype.require.bind(module.parent);
metapathRequire.cache = require.cache;

module.exports = {
    require:metapathRequire,
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
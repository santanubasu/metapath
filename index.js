Error.stackTraceLimit = 1000;

if (!global._metapath) {
    global._metapath = {
        tenantCache:{},
        tenantMetapaths:{},
        activeTenant:""
    };
}

if (!global.__stack) {
    Object.defineProperty(global, "__stack", {
        get: function(){
            var orig = Error.prepareStackTrace;
            Error.prepareStackTrace = function(_, stack){ return stack; };
            var err = new Error;
            Error.captureStackTrace(err, arguments.callee);
            var stack = err.stack;
            Error.prepareStackTrace = orig;
            return stack;
        }
    });
}

var path = require("path");
var resolve = require("resolve");
var _ = require("underscore");
var extend = require("node.extend");
var check = require("check-more-types");
var Module = require("module");

global._metapath.tenantCache[global._metapath.activeTenant] = {};

function getCallerDirname(skip) {
    return path.dirname(getCallerFilename())
}

function getCallerFilename(skip) {
    skip = skip||0;
    var callerFileName;
    var index = 0;
    var entries = __stack.map(function(cs) {
        return cs.getFileName()
    })
    while (!callerFileName) {
        var entry = entries[index];
        index++;
        if (entry&&entry.indexOf("native")<0&&entry!==__filename) {
            callerFileName = entry;
        }
    }
    return callerFileName;
}

function resolveDependencyRoot(dependency, from) {
    var callerDirname = from||getCallerDirname();
    var dependencyPath = resolve.sync(dependency, {
        basedir:callerDirname
    });
    var fullPath = path.dirname(dependencyPath);
    var parts = fullPath.split("/");
    for (var i=parts.length; i>0; i--) {
        if (parts[i-1]==="node_modules") {
            break;
        }
    }
    var dependencyRoot = parts.slice(0, i+1).join("/");
    return dependencyRoot;
}


module.exports = {
    require: _.once(function() {
        // Require hijacking is based on https://github.com/bahmutov/really-need

        // these variables are needed inside eval _compile
        /* jshint -W098 */
        var runInNewContext = require('vm').runInNewContext;
        var runInThisContext = require('vm').runInThisContext;
        var path = require('path');
        var shebangRe = /^\#\!.*/;

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

        Module.prototype.require = function(name, tenantArg, options) {

            options = options||{};

            if (_.isString(tenantArg)) {
                global._metapath.activeTenant = tenantArg;
            }

            var nameToLoad;
            var result;

            try {
                if (global._metapath.tenantMetapaths[global._metapath.activeTenant] && name in global._metapath.tenantMetapaths[global._metapath.activeTenant]) {
                    var callerFilename = getCallerFilename();
                    var absolutePath = global._metapath.tenantMetapaths[global._metapath.activeTenant][name].absolute;
                    if (callerFilename in global._metapath.tenantMetapaths[global._metapath.activeTenant][name].supers.absolute) {
                        absolutePath = global._metapath.tenantMetapaths[global._metapath.activeTenant][name].supers.absolute[callerFilename].absolute;
                    }
                    nameToLoad = Module._resolveFilename(absolutePath, this);
                }
                else {
                    nameToLoad = Module._resolveFilename(name, this);
                }
            }
            catch (e) {
                throw "Unable to resolve dependency "+name+" in dynamic require.";
            }

            try {
                if (global._metapath.tenantCache[global._metapath.activeTenant] && nameToLoad in global._metapath.tenantCache[global._metapath.activeTenant]) {
                    result = global._metapath.tenantCache[global._metapath.activeTenant][nameToLoad];
                }
                else {
                    result = Module._load(nameToLoad, this);
                    global._metapath.tenantCache[global._metapath.activeTenant][nameToLoad] = result;
                    delete require.cache[nameToLoad];
                }
            }
            catch (e) {
                console.log("Unable to load dependency "+name+" in dynamic require, resolved name was "+nameToLoad);
                throw e;
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
            var result = patchedCompile.call(this, content, filename);
            return result;
        };

        var dynamicRequire = Module.prototype.require.bind(module.parent);
        dynamicRequire.cache = require.cache;
        return dynamicRequire;
    }),
    configureTenant:function(tenant, tenantMetapath) {
        global._metapath.tenantCache[tenant] = {};
        global._metapath.tenantMetapaths[tenant] = tenantMetapath;
    },
    activateTenant:function(tenant) {
        global._metapath.activeTenant = tenant;
    },
    import:function(dependency, root) {
        var callerDirname = root?root:getCallerDirname(1);
        var dependencyRoot = resolveDependencyRoot(dependency, callerDirname);
        return prefix(
            require(path.join(dependencyRoot, "metapath.js")),
            "",
            path.relative(callerDirname, dependencyRoot)+"/"
        );
    },
    from:function(target, root) {
        var paths = [];
        var prefixes = [];
        var callerDirname = root?root:getCallerDirname(1);
        var base;
        var pathPrefix;
        if (target.indexOf("/")!==-1) {
            base = target;
            pathPrefix = path.normalize(path.join(".", path.relative(callerDirname, base)));
        }
        else {
            base = resolveDependencyRoot(target, callerDirname);
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
        var key = path.join("/", path.relative(dir, file));
        var mapping = {
            relative:path.normalize(path.join("/", path.relative(base, file))),
            absolute:file,
            supers:{
                relative:{},
                absolute:{}
            }
        }
        mappings[key] = mapping;
    });

    return mappings;
}

var compose = module.exports.compose = function(source, target) {
    if (_.isArray(source)) {
        return composeAll(source, target);
    }
    target = target||{};
    for (var key in source) {
        if (key in target) {
            var superAbsolute = target[key].absolute;
            var superRelative = target[key].relative;
            extend(true, target[key], source[key]);
            target[key].supers.absolute[source[key].absolute] = {
                absolute:superAbsolute,
                relative:superRelative
            };
            target[key].supers.relative[source[key].relative] = {
                absolute:superAbsolute,
                relative:superRelative
            };
        }
        else {
            target[key] = extend(true, {}, source[key])
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
        prefixedMetapath[keyPrefix+key] = {
            relative:path.normalize(valuePrefix+metapath[key].relative),
            absolute:metapath[key].absolute,
            supers:extend(true, {}, metapath[key].supers)
        };
    }
    return prefixedMetapath;
}

var replace = module.exports.replace = function(source, sourcePath, metapaths, type, base) {
    type = type||"absolute";
    function buildReplacer(delimitter) {
        return function(match, metapath) {
            if (metapath in metapaths) {
                var resolvedPath = metapaths[metapath][type];
                if (sourcePath in metapaths[metapath].supers.absolute) {
                    resolvedPath = metapaths[metapath].supers.absolute[sourcePath][type];
                }
                if ("relative"===type&&base) {
                    resolvedPath = path.relative(base, resolvedPath);
                }
                return delimitter+resolvedPath;
            }
            else {
                console.log("Unable to resolve metapath: "+metapath);
                return delimitter+metapath;
            }
        }
    }
    return source
        .replace(/"(\s*metapath:\/\/[^"?#]+)/g, buildReplacer("\""))
        .replace(/'(\s*metapath:\/\/[^'?#]+)/g, buildReplacer("\'"))
}

var getAbsoluteMap = module.exports.getAbsoluteMap = function(metapaths) {
    return _.mapObject(metapaths, function(mapping, key) {
        return mapping.absolute
    })
}

var getRelativeMap = module.exports.getRelativeMap = function(metapaths) {
    return _.mapObject(metapaths, function(mapping, key) {
        return mapping.relative
    })
}
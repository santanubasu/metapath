var _ = require("underscore");
var resolve = require('resolve');
var path = require("path");

function _getCallerDirname() {
    try {
        var err = new Error();
        var callerFile;
        var currentFile;

        Error.prepareStackTrace = function (err, stack) { return stack; };

        currentFile = err.stack.shift().getFileName();

        while (err.stack.length) {
            callerFile = err.stack.shift().getFileName();
            if (currentFile !== callerFile) {
                return path.dirname(callerFile);
            }
        }
    }
    catch (err) {
    }
    return undefined;
}

function _resolveDependencyRoot(dependency) {
    var callerDirname = _getCallerDirname();
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
    require:function(dependency) {
        var callerDirname = _getCallerDirname();
        var dependencyRoot = _resolveDependencyRoot(dependency);
        return prefix(
            require(path.join(dependencyRoot, "/metapath.js")),
            "",
            path.relative(callerDirname, dependencyRoot)+"/"
        );
    },
    from:function(target) {
        var paths = [];
        var prefixes = [];
        var callerDirname = _getCallerDirname();
        var base;
        var pathPrefix;
        if (target.indexOf("/")!==-1) {
            base = target;
            pathPrefix = path.relative(callerDirname, base);
        }
        else {
            base = _resolveDependencyRoot(target);
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


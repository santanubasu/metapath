var _ = require("underscore");
var path = require("path");
var pick = require("pick-require");
var pickUtil = pick("pick-require", "util.js");

module.exports = {
    require:function(dependency) {
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
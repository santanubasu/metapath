var _ = require("underscore");

var from = module.exports.from = function(base) {
    return {
        paths:[],
        prefixes:[],
        require:function(moduleName) {
            return prefix(
                require("node_modules/"+moduleName+"/metapath.js"),
                "",
                "node_modules/"+moduleName+"/"
            )
        },
        add:function(path) {
            if (_.isArray(path)) {
                [].push.apply(this.paths, path);
            }
            else {
                this.paths.push(path);
            }
            return this;
        },
        to:function(keyPrefix, valuePrefix) {
            this.prefixes.push([
                keyPrefix,
                valuePrefix
            ]);
            return this;
        },
        compose:function() {
            return composeAll(this.paths.map(function(path) {
                return composeAll(this.prefixes.map(function(prefix) {
                    return build(base, path, prefix[0], prefix[1]);
                }));
            }.bind(this)));
        }
    }
}

var build = module.exports.build = function(base, dir, keyPrefix, valuePrefix) {
    return prefix(buildFrom(base, base+dir), keyPrefix, valuePrefix);
}

var buildFrom = module.exports.buildFrom = function(base, dir) {
    var glob = require("glob");
    base = base||dir;
    if (!(base.charAt(base.length-1)==="/")) {
        base = base+"/"
    }
    var mappings = {};
    var files = glob.sync(dir+"/**/*")
    files.forEach(function(path) {
        var metapath = path.replace(dir, "");
        var relativePath = path.replace(base, "");
        if (metapath.charAt(0)!=="/") {
            metapath = "/"+metapath;
        }
        mappings[metapath] = relativePath;
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
        prefixedMetapath[keyPrefix+key] = valuePrefix+metapath[key];
    }
    return prefixedMetapath;
}

var http = require("http"),
  https = require("https"),
  zlib = require("zlib");

var prerender = (module.exports = function (req, res, next) {
  if (!prerender.shouldShowPrerenderedPage(req)) return next();

  prerender.beforeRenderFn(req, function (err, cachedRender) {
    if (!err && cachedRender) {
      if (typeof cachedRender == "string") {
        res.writeHead(200, {
          "Content-Type": "text/html",
        });
        return res.end(cachedRender);
      } else if (typeof cachedRender == "object") {
        res.writeHead(cachedRender.status || 200, {
          "Content-Type": "text/html",
          ...(cachedRender.headers || {}),
        });
        return res.end(cachedRender.body || "");
      }
    }

    prerender.getPrerenderedPageResponse(
      req,
      function (err, prerenderedResponse) {
        prerender.afterRenderFn(err, req, prerenderedResponse);

        if (prerenderedResponse) {
          res.writeHead(
            prerenderedResponse.statusCode,
            prerenderedResponse.headers,
          );
          return res.end(prerenderedResponse.body);
        } else {
          next(err);
        }
      },
    );
  });
});

prerender.crawlerUserAgents = [
  "googlebot",
  "Yahoo! Slurp",
  "bingbot",
  "yandex",
  "baiduspider",
  "facebookexternalhit",
  "twitterbot",
  "rogerbot",
  "linkedinbot",
  "embedly",
  "quora link preview",
  "showyoubot",
  "outbrain",
  "pinterest/0.",
  "developers.google.com/+/web/snippet",
  "slackbot",
  "vkShare",
  "W3C_Validator",
  "redditbot",
  "Applebot",
  "WhatsApp",
  "flipboard",
  "tumblr",
  "bitlybot",
  "SkypeUriPreview",
  "nuzzel",
  "Discordbot",
  "Google Page Speed",
  "Qwantify",
  "pinterestbot",
  "Bitrix link preview",
  "XING-contenttabreceiver",
  "Chrome-Lighthouse",
];

prerender.extensionsToIgnore = [
  ".js",
  ".css",
  ".xml",
  ".less",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".pdf",
  ".doc",
  ".txt",
  ".ico",
  ".rss",
  ".zip",
  ".mp3",
  ".rar",
  ".exe",
  ".wmv",
  ".doc",
  ".avi",
  ".ppt",
  ".mpg",
  ".mpeg",
  ".tif",
  ".wav",
  ".mov",
  ".psd",
  ".ai",
  ".xls",
  ".mp4",
  ".m4a",
  ".swf",
  ".dat",
  ".dmg",
  ".iso",
  ".flv",
  ".m4v",
  ".torrent",
  ".woff",
  ".ttf",
  ".svg",
  ".webmanifest",
];

prerender.whitelisted = function (whitelist) {
  prerender.whitelist = typeof whitelist === "string" ? [whitelist] : whitelist;
  return this;
};

prerender.blacklisted = function (blacklist) {
  prerender.blacklist = typeof blacklist === "string" ? [blacklist] : blacklist;
  return this;
};

prerender.shouldShowPrerenderedPage = function (req) {
  var userAgent = req.headers["user-agent"],
    bufferAgent = req.headers["x-bufferbot"],
    isRequestingPrerenderedPage = false;

  if (!userAgent) return false;
  if (req.method != "GET" && req.method != "HEAD") return false;
  if (req.headers && req.headers["x-prerender"]) return false;

  //if it contains _escaped_fragment_, show prerendered page
  var parsedUrl = new URL(req.url, "http://localhost");
  if (parsedUrl.searchParams.has("_escaped_fragment_"))
    isRequestingPrerenderedPage = true;

  //if it is a bot...show prerendered page
  if (
    prerender.crawlerUserAgents.some(function (crawlerUserAgent) {
      return (
        userAgent.toLowerCase().indexOf(crawlerUserAgent.toLowerCase()) !== -1
      );
    })
  )
    isRequestingPrerenderedPage = true;

  //if it is BufferBot...show prerendered page
  if (bufferAgent) isRequestingPrerenderedPage = true;

  //if it is a bot and is requesting a resource...dont prerender
  if (
    prerender.extensionsToIgnore.some(function (extension) {
      return req.url.toLowerCase().indexOf(extension) !== -1;
    })
  )
    return false;

  //if it is a bot and not requesting a resource and is not whitelisted...dont prerender
  if (
    Array.isArray(this.whitelist) &&
    this.whitelist.every(function (whitelisted) {
      return new RegExp(whitelisted).test(req.url) === false;
    })
  )
    return false;

  //if it is a bot and not requesting a resource and is not blacklisted(url or referer)...dont prerender
  if (
    Array.isArray(this.blacklist) &&
    this.blacklist.some(function (blacklisted) {
      var blacklistedUrl = false,
        blacklistedReferer = false,
        regex = new RegExp(blacklisted);

      blacklistedUrl = regex.test(req.url) === true;
      if (req.headers["referer"])
        blacklistedReferer = regex.test(req.headers["referer"]) === true;

      return blacklistedUrl || blacklistedReferer;
    })
  )
    return false;

  return isRequestingPrerenderedPage;
};

prerender.prerenderServerRequestOptions = {};

prerender.getPrerenderedPageResponse = function (req, callback) {
  var apiUrl = new URL(prerender.buildApiUrl(req));
  var headers = {};
  if (this.forwardHeaders === true) {
    Object.keys(req.headers).forEach(function (h) {
      // Forwarding the host header can cause issues with server platforms that require it to match the URL
      if (h == "host") {
        return;
      }
      headers[h] = req.headers[h];
    });
  }
  headers["User-Agent"] = req.headers["user-agent"];
  headers["Accept-Encoding"] = "gzip";
  if (this.prerenderToken || process.env.PRERENDER_TOKEN) {
    headers["X-Prerender-Token"] =
      this.prerenderToken || process.env.PRERENDER_TOKEN;
  }

  var options = {
    method: "GET",
    protocol: apiUrl.protocol,
    hostname: apiUrl.hostname,
    port: apiUrl.port || (apiUrl.protocol === "https:" ? 443 : 80),
    path: apiUrl.pathname + apiUrl.search,
    headers: headers,
    timeout: 30000,
  };
  for (var attrname in this.prerenderServerRequestOptions) {
    if (attrname === "headers") {
      Object.assign(
        options.headers,
        this.prerenderServerRequestOptions.headers,
      );
    } else {
      options[attrname] = this.prerenderServerRequestOptions[attrname];
    }
  }

  var transport = options.protocol === "https:" ? https : http;
  var settled = false;
  var done = function (err, response) {
    if (settled) return;
    settled = true;
    callback(err, response);
  };

  var clientReq = transport.request(options, function (response) {
    response.on("error", done);
    if (
      response.headers["content-encoding"] &&
      response.headers["content-encoding"] === "gzip"
    ) {
      prerender.gunzipResponse(response, done);
    } else {
      prerender.plainResponse(response, done);
    }
  });
  clientReq.on("error", done);
  clientReq.on("timeout", function () {
    clientReq.destroy(new Error("prerender request timeout"));
  });
  clientReq.end();
};

prerender.gunzipResponse = function (response, callback) {
  var gunzip = zlib.createGunzip();
  var chunks = [];

  gunzip.on("data", function (chunk) {
    chunks.push(chunk);
  });
  gunzip.on("end", function () {
    response.body = Buffer.concat(chunks).toString("utf8");
    delete response.headers["content-encoding"];
    delete response.headers["content-length"];
    callback(null, response);
  });
  gunzip.on("error", callback);

  response.pipe(gunzip);
};

prerender.plainResponse = function (response, callback) {
  var chunks = [];

  response.on("data", function (chunk) {
    chunks.push(chunk);
  });
  response.on("end", function () {
    response.body = Buffer.concat(chunks).toString("utf8");
    callback(null, response);
  });
};

prerender.buildApiUrl = function (req) {
  var prerenderUrl = prerender.getPrerenderServiceUrl();
  var forwardSlash =
    prerenderUrl.indexOf("/", prerenderUrl.length - 1) !== -1 ? "" : "/";

  var conn = req.socket || req.connection;
  var protocol = conn && conn.encrypted ? "https" : "http";
  if (req.headers["cf-visitor"]) {
    var match = req.headers["cf-visitor"].match(/"scheme":"(http|https)"/);
    if (match) protocol = match[1];
  }
  if (req.headers["x-forwarded-proto"]) {
    protocol = req.headers["x-forwarded-proto"].split(",")[0];
  }
  if (this.protocol) {
    protocol = this.protocol;
  }
  var fullUrl =
    protocol +
    "://" +
    (this.host || req.headers["x-forwarded-host"] || req.headers["host"]) +
    req.url;
  return prerenderUrl + forwardSlash + fullUrl;
};

prerender.getPrerenderServiceUrl = function () {
  return (
    this.prerenderServiceUrl ||
    process.env.PRERENDER_SERVICE_URL ||
    "https://service.prerender.io/"
  );
};

prerender.beforeRenderFn = function (req, done) {
  if (!this.beforeRender) return done();

  return this.beforeRender(req, done);
};

prerender.afterRenderFn = function (err, req, prerender_res) {
  if (!this.afterRender) return;

  this.afterRender(err, req, prerender_res);
};

prerender.set = function (name, value) {
  this[name] = value;
  return this;
};

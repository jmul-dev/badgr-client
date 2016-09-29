/**
 * This class borrows heavily from the badgekit-api-client module.
 */
'use strict';

var request = require('request');
var url = require('url');
var http = require('http');
var fs = require('fs');
var mime = require('mime');
var formatString = require('util').format;

function makeUrl (endpoint, path, query) {
  var uri = url.resolve(endpoint, path);
  if (query) {
    uri = url.parse(uri, true);
    uri.query = Object.keys(query).reduce(function (q, key) {
      q[key] = query[key];
      return (q);
    }, uri.query || {});
    delete uri.search;
    uri = url.format(uri);
  }
  return uri.replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\!/g, '%21')
    .replace(/\*/g, '%2A');
}

function errorNameFromStatusCode (code) {
  var status = http.STATUS_CODES[parseInt(code, 10)];

  if (!status) { return null; }

  var errorName = status.split(/\s+/).reduce(function(name, part) {
    name += part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    return name;
  }, '').replace(/\W+/g, '');

  if (!(/Error$/).test(errorName)) { errorName += 'Error'; }

  return errorName;
}

function fixError (res, body) {
  var errName = body.code || (body.error ? body.error.code : '');
  var errMsg = body.message || (body.error ? body.error.message : '') || '';

  if (errName) {
    if (!(/Error$/).test(errName)) {
      errName += 'Error';
    }
  } else {
    errName = errorNameFromStatusCode(res.statusCode) || 'Http' + res.statusCode + 'Error';
  }

  var err = new Error(errMsg);
  Object.defineProperties(err, {
    code: {value: res.statusCode},
    name: {value: errName},
    details: {value: body.details}
  });

  return err;
}

function encodeDataItem (key, value) {
  if (key === 'image' && (/^[\/\.]/).test(value)) {
    value = {
      path: value,
      type: mime.lookup(value)
    };
  }

  if (value && value.type && (value.path || value.data)) {
    var data = (value.data || fs.readFileSync(value.path)).toString('base64');
    value = formatString('data:%s;base64,%s', value.type, data);
  }

  return value;
}

/**
 * This class borrows heavily from the badgekit-api-client module.
 * @param endpoint
 * @param auth
 * @returns {Remote}
 * @constructor
 */
function Remote (endpoint, auth) {
  if (!endpoint || !auth) { throw new Error('Client needs an endpoint and auth details to be provided'); }
  var self = this;
  self.endpoint = endpoint;
  self.auth = auth;
  if (!(this instanceof Remote)) { return new Remote(endpoint, auth); }

  function makeCall (method, meta, cb) {
    if (typeof meta === 'string') { meta = {path: meta}; }
    var filter = meta.filter;
    var defaultValue = meta.default;

    self.getToken(function (err, token) {
      if (err) { return cb(err); }
      var config = {
        url: makeUrl(endpoint, meta.path, meta.query),
        method: method,
        headers: {
          'User-Agent': 'Badgr-client',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Token ' + token
        }
      };
      if (meta.data) {
        config.body = JSON.stringify(meta.data, encodeDataItem);
      }

      if (meta.qs) {
        config.qs = meta.qs;
      }

      request(config, function (error, rsp, body) {
        if (typeof cb !== 'function') { return; }

        if (typeof body === 'string') {
          try {
            body = JSON.parse(body);
          } catch (e) {
            // NO-OP - leave body as is
          }
        }

        if (error) {
          if (error.name === 'Error') { Object.defineProperty(error, 'name', {value: 'HttpError'}); }
          return cb(error, null);
        }

        if (rsp.statusCode >= 400) {
          cb(fixError(rsp, body), null);
        } else {
          if (filter) {
            body = (body||{})[filter];
          }

          if (typeof body === 'undefined') {
            body = defaultValue;
          }

          cb(null, body);
        }
      });

    });
  }

  ['get', 'post', 'put', 'delete'].forEach(function (method) {
    Object.defineProperty(this, method, {
      enumerable: true,
      value: makeCall.bind(this, method)
    });
  }.bind(this));

}

Remote.prototype.getToken = function(callback) {
  var self = this;
  if (self.token) {
    return callback(null, this.token);
  } else {
    var config = {
      url: this.endpoint + 'api-auth/token',
      method: 'post',
      formData: this.auth
    };
    request(config, function (err, rsp, body) {
      if (err) { return callback(err); }
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch (e) {
          return callback(e);
        }
      }
      if (body && body.token) {
        self.token = body.token;
        return callback(null, body.token);
      } else {
        return callback(new Error(JSON.stringify(body)));
      }
    });
  }
};

module.exports = Remote;

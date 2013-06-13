const
http = require('http'),
aws = require('./aws.js'),
xml2js = new (require('xml2js')).Parser(),
jsel = require('JSONSelect');

function doRequest(api_key, method, path, body, cb) {
  var req = http.request({
    auth: api_key,
    host: 'ns.zerigo.com',
    port: 80,
    path: path,
    method: method,
    headers: {
      'Content-Type': 'application/xml',
      'Content-Length': body ? body.length : 0
    }
  }, function(r) {
    var buf = "";
    r.on('data', function(chunk) {
      buf += chunk;
    });
    r.on('end', function() {
      if ((r.statusCode / 100).toFixed(0) != 2 &&
          r.statusCode != 404) {
        return cb("non 200 status: " + r.statusCode + "(" + body + ")");
      }
      xml2js.parseString(buf, cb);
    });
  });
  if (body) req.write(body);
  req.end();
};

exports.updateRecord = function (key, hostname, ip, cb) {
  if (typeof key !== 'string' || !hostname) return process.nextTick(function() { cb(null) });

  exports.deleteRecord(key, hostname, function(err) {
    if (err && err !== 'no such DNS record') return cb(err);

    doRequest(key, 'GET', '/api/1.1/zones.xml', null, function(err, r) {
      var host = "";
      if (err) return cb(err);
      var m = jsel.match('object:has(:root > .domain:val(?)) > .id .#',
                         [ hostname ], r);
      if (m.length != 1) {
        host = hostname.split('.')[0];
        hostname = hostname.split('.').slice(1).join('.');
        var m = jsel.match('object:has(:root > .domain:val(?)) > .id .#',
                           [ hostname ], r);
        if (m.length != 1) return cb("couldn't extract domain id from zerigo");
      }

      var path = '/api/1.1/hosts.xml?zone_id=' + m[0];
      var body = '<host><data>' + ip + '</data><host-type>A</host-type>';
      body += '<hostname>' + host + '</hostname>'
      body += '</host>';
      doRequest(key, 'POST', path, body, function(err, r) {
        cb(err);
      });
    });
  });
};

exports.listDomains = function(cb) {
  aws.route53.ListHostedZones(function(err, result) {
    if (err) return cb(err);
    cb(null, result.Body.ListHostedZonesResponse.HostedZones.HostedZone);
  });
}

function convertZoneIdUrlToJustId(zoneId) {
    var m = zoneId.match(/\/[^\/]+$/);
    return m[0];
}

exports.listHosts = function(domainName, cb) {
  aws.route53.ListHostedZones(function(err, result) {
    if (err) return cb(err);
    var domains = result.Body.ListHostedZonesResponse.HostedZones.HostedZone.filter(function(zone) {
        return zone.Name === domainName;
    });

    // get this domain info
    var domainInfo = domains[0];
    domainInfo.hostedZoneId = convertZoneIdUrlToJustId(domainInfo.Id);
    aws.route53.ListResourceRecordSets({ HostedZoneId : domainInfo.hostedZoneId }, function(err, result) {
      if (err) return cb(err);

      // get the resource records
      var hosts = jsel.match('.ResourceRecordSet', result);
      cb(null, hosts[0]);
    });
  });
}

exports.findByIP = function (ip, cb) {
  exports.listDomains(function(err, zones) {
    if (err) return cb(err);

    // if there are no zones, then we can't find this IP address
    if (!zones.length) return cb(null, []);

    zones.forEach(function(zone) {
      var m = zone.Id.match(/\/[^\/]+$/);
      zone.ZoneId = m[0];
    });

    // now, got through each zone and get the record sets (or hosts)
    var done = 0;
    var found = [];
    var failed;

    zones.forEach(function(zone) {
      aws.route53.ListResourceRecordSets({ HostedZoneId : zone.ZoneId }, function(err, result) {
        if (failed) return;
        if (err) {
          failed = err;
          return cb(err);
        }

        // remember how many zones we have received
        done++;

        var sets = result.Body.ListResourceRecordSetsResponse.ResourceRecordSets.ResourceRecordSet;
        sets.forEach(function(set) {
          // if this is not an 'A' record, then skip it
          if ( set.Type !== 'A' ) {
            return;
          }

          var rrs = set.ResourceRecords.ResourceRecord;
          if ( !Array.isArray(rrs) ) {
            rrs = [ rrs ];
          }
          rrs.forEach(function(rr) {
            if ( ip == rr.Value ) {
              found.push(set.Name);
            }
          });
        });

        // if we have received and processed all replies, then callback
        if (done === zones.length) {
          cb(null, found);
        }

      });
    });
  });
};

exports.deleteRecord = function (key, hostname, cb) {
  doRequest(key, 'GET', '/api/1.1/hosts.xml?fqdn=' + hostname, null, function(err, r) {
    if (err) return cb(err);
    var m = jsel.match('.host .id > .#', r);
    if (!m.length) return cb("no such DNS record");
    function deleteOne() {
      if (!m.length) return cb(null);
      var one = m.shift();
      doRequest(key, 'DELETE', '/api/1.1/hosts/' + one + '.xml', null, function(err) {
        if (err) return cb(err);
        deleteOne();
      });
    }
    deleteOne();
  });
};

exports.inUse = function (key, hostname, cb) {
  if (!key || !hostname) return process.nextTick(function() { cb(null) });
  doRequest(key, 'GET', '/api/1.1/hosts.xml?fqdn=' + hostname, null, function(err, r) {
    if (err) return cb(err);
    var m = jsel.match('.host', r);
    // we shouldn't have multiple!  oops!  let's return the first one
    if (m.length) return cb(null, m[0]);
    cb(null, null);
  });
}

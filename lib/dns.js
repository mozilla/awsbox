const
http = require('http'),
aws = require('./aws.js'),
xml2js = new (require('xml2js')).Parser(),
jsel = require('JSONSelect');
const fmt = require('fmt');

function convertZoneIdUrlToJustId(zoneId) {
    var m = zoneId.match(/\/([^\/]+)$/);
    return m[1];
}

function addTrailingDotToDomain(domain) {
    if ( domain.match(/\.$/) ) {
        return domain;
    }
    return domain + '.';
}

exports.updateRecord = function (hostname, ip, cb) {
  if (!hostname || !ip) return process.nextTick(function() { cb('No hostname/ip address provided') });
  hostname = addTrailingDotToDomain(hostname);

  // split hostname into two (e.g. blah.example.org -> blah and example.org)
  var subdomain = hostname.split('.')[0];
  var domain = hostname.split('.').slice(1).join('.');

  // since Route53 uses trailing dots on domain names, we need to add them
  domain = addTrailingDotToDomain(domain);

  // firstly, get this domain
  aws.route53.ListHostedZones(function(err, result) {
    if (err) return cb(err);
    var zones = result.Body.ListHostedZonesResponse.HostedZones.HostedZone;
    var foundZone;
    zones.forEach(function(zone) {
      if ( zone.Name === domain ) {
        foundZone = zone;
      }
    });

    if ( !foundZone ) {
      return cb('No zone found for hostname ' + hostname);
    }

    // set the ZoneId
    foundZone.ZoneId = convertZoneIdUrlToJustId(foundZone.Id);

    // this list of changes will be either a [DELETE,CREATE] or a [CREATE]
    var changes = [];

    // now find out the current value (if any) for this hostname
    aws.route53.ListResourceRecordSets({ HostedZoneId : foundZone.ZoneId }, function(err, res) {
      if (err) return cb(err);

      // ToDo: figure out if this record is already there - and DELETE it
      var rrs = res.Body.ListResourceRecordSetsResponse.ResourceRecordSets.ResourceRecordSet
      var currentResourceRecords = rrs.filter(function(rr) {
          return rr.Name === hostname && rr.Type === 'A';
      });

      if ( currentResourceRecords.length ) {
        // we have a current "hostname A" record, so delete it first
        changes.push({
          Action : 'DELETE',
          Name   : hostname,
          Type   : 'A',
          Ttl    : currentResourceRecords[0].TTL,
          ResourceRecords : currentResourceRecords[0].ResourceRecords.ResourceRecord,
        });
      }

      // now create the new Resource Record
      changes.push({
        Action : 'CREATE',
        Name   : hostname,
        Type   : 'A',
        Ttl    : 600,
        ResourceRecords : [ ip ],
      });

      // send the change to the resource records
      var changeset = {
        HostedZoneId : foundZone.ZoneId,
        Changes      : changes,
      };
      aws.route53.ChangeResourceRecordSets(changeset, function(err, result) {
        if (err) return cb(err);
        cb(null, result);
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

exports.deleteRecord = function (hostname, cb) {
  if (!hostname) return process.nextTick(function() {
      cb('No hostname provided');
  });
  hostname = addTrailingDotToDomain(hostname);

  // split hostname into two (e.g. blah.example.org -> blah and example.org)
  var subdomain = hostname.split('.')[0];
  var domain = hostname.split('.').slice(1).join('.');

  // since Route53 uses trailing dots on domain names, we need to add them
  domain = addTrailingDotToDomain(domain);

  // firstly, get this domain
  aws.route53.ListHostedZones(function(err, result) {
    if (err) return cb(err);
    var zones = result.Body.ListHostedZonesResponse.HostedZones.HostedZone;
    var foundZone;
    zones.forEach(function(zone) {
      if ( zone.Name === domain ) {
        foundZone = zone;
      }
    });

    if ( !foundZone ) {
      return cb('No zone found for hostname ' + hostname);
    }

    // set the ZoneId
    foundZone.ZoneId = convertZoneIdUrlToJustId(foundZone.Id);

    // this list of changes will be either a [DELETE,CREATE] or a [CREATE]
    var changes = [];

    // get all of the ResourceRecords
    aws.route53.ListResourceRecordSets({ HostedZoneId : foundZone.ZoneId }, function(err, res) {
      if (err) return cb(err);

      // figure out if this record is already there - and DELETE it
      var rrs = res.Body.ListResourceRecordSetsResponse.ResourceRecordSets.ResourceRecordSet
      var currentResourceRecords = rrs.filter(function(rr) {
          return rr.Name === hostname && rr.Type === 'A';
      });

      if ( currentResourceRecords.length ) {
        // we have a current "hostname A" record, so delete it first
        changes.push({
          Action : 'DELETE',
          Name   : hostname,
          Type   : 'A',
          Ttl    : currentResourceRecords[0].TTL,
          ResourceRecords : currentResourceRecords[0].ResourceRecords.ResourceRecord,
        });
      }

      // send the change to the resource records
      var changeset = {
        HostedZoneId : foundZone.ZoneId,
        Changes      : changes,
      };
      aws.route53.ChangeResourceRecordSets(changeset, function(err, result) {
        if (err) return cb(err);
        cb(null, result);
      });

    });
  });
};

exports.inUse = function (hostname, cb) {
  if (!hostname) return process.nextTick(function() {
      cb('No hostname provided');
  });
  hostname = addTrailingDotToDomain(hostname);

  // firstly, get this domain
  aws.route53.ListHostedZones(function(err, result) {
    if (err) return cb(err);
    var zones = result.Body.ListHostedZonesResponse.HostedZones.HostedZone;
    var foundZone;
    zones.forEach(function(zone) {
      if ( zone.Name === hostname ) {
        foundZone = zone;
      }
    });

    if ( !foundZone ) {
      return cb('No zone found for hostname ' + hostname);
    }

    // all ok
    cb(null, foundZone);
  });
}

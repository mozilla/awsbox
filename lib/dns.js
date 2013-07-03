const
http = require('http'),
aws = require('./aws.js'),
xml2js = new (require('xml2js')).Parser(),
jsel = require('JSONSelect'),
async = require('async');

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
  aws.niceRoute53.zones(cb);
}

exports.listHosts = function(domainName, cb) {
  aws.niceRoute53.records(domainName, cb);
}

exports.findByIP = function (ip, cb) {
  var found = [];

  // firstly, get all the zones, then get all of the records for each zone
  aws.niceRoute53.zones(function(err, zones) {
    if (err) return cb(err);
    async.each(
      zones,
      function(zone, done) {
        // get the records for this zone
        aws.niceRoute53.records(zone.zoneId, function(err, records) {
          if (err) return done(err);

          // loop through each record
          records.forEach(function(record) {
            // if this is not an 'A' record, then skip it
            if ( record.type !== 'A' ) return;

            // now check all of the values for this A record
            record.values.forEach(function(value) {
              if ( value === ip ) {
                found.push(record.name);
              }
            });
          });

          // tell async this zone has finished
          done();
        });
      },
      // when everything is done, tell the caller the err (if any) and the found list
      function(err) {
        cb(err, found);
      }
    );
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

  aws.niceRoute53.zoneInfo(hostname, function(err, zoneInfo) {
    if (err) {
      return cb(err);
    }

    if ( !zoneInfo ) {
      return cb('No zone found for hostname ' + hostname);
    }

    cb(null, zoneInfo);
  });
}

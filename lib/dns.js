const
http = require('http'),
aws = require('./aws.js'),
xml2js = new (require('xml2js')).Parser(),
jsel = require('JSONSelect'),
async = require('async');

exports.updateRecord = function (hostname, ip, cb) {
  if (!hostname || !ip) {
    return process.nextTick(function() {
      cb('No hostname/ip address provided');
    });
  }

  // split hostname into two (e.g. blah.example.org -> blah and example.org)
  var domain = hostname.split('.').slice(1).join('.');

  // firstly, get the zoneInfo
  aws.niceRoute53.zoneInfo(domain, function(err, zoneInfo) {
    if (err) return cb(err);

    var args = {
      zoneId : zoneInfo.zoneId,
      name   : hostname,
      type   : 'A',
      ttl    : 60,
      values : [ ip ]
    };
    aws.niceRoute53.setRecord(args, 10, cb);
  });
};

exports.listDomains = function(cb) {
  aws.niceRoute53.zones(cb);
};

exports.listHosts = function(domainName, cb) {
  aws.niceRoute53.records(domainName, cb);
};

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
  if (!hostname) throw new Error('No hostname provided');

  // split hostname into two (e.g. blah.example.org -> blah and example.org)
  var domain = hostname.split('.').slice(1).join('.');

  aws.niceRoute53.zoneInfo(domain, function(err, zoneInfo) {
    if (err) return cb(err);

    // Note: we're always deleting A records here
    var args = {
      zoneId : zoneInfo.zoneId,
      name   : hostname,
      type   : 'A',
    };
    aws.niceRoute53.delRecord(args, 10, cb);
  });
};

exports.inUse = function(hostname, cb) {
  if (!hostname) {
    return process.nextTick(function() { cb("no hostname provided"); });
  }

  var found;

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

            // check if this record.name is the same as the one we want
            if ( record.name === hostname ) {
              found = {
                name   : record.name,
                values : record.values,
              };
            }
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

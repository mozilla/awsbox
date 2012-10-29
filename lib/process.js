/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const
child_process = require('child_process'),
util = require('util');

exports.exec = function(cmd, done) {
  if (!cmd) done(null);

  var childProcess = child_process.exec(cmd, {
    env: process.env
  }, done);

  childProcess.stdout.on('data', function(data) {
    util.print(data.toString());
  });

  childProcess.stderr.on('data', function(data) {
    util.error(data.toString());
  });
};


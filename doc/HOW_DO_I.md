# How Do I XXX in awsbox?

This is a cookbook of how to Get Common Things Done with
awsbox.

## How Do I Push Code?

If you use awsbox from an existing project, a git "remote" will
be added for you with the name of the machine you chose (with the
-n flag).

## How Do I SSH into my VM?

You can SSH as the user that runs your app:

    $ ssh app@[ip address]

Or as an admin user with sudo privileges

    $ ssh ec2-user@[ip address]

## How Do I Check My Server Logs?

    $ ssh app@[ip address] 'tail -F var/log/*'

## How Do I Restart The Web Services On My Server?

    $ ssh app@[ip address] 'forever restartall'

## How Do I Give Other People Access to the VM?

Add their key to `~ec2-user/.ssh/authorized_keys` to give access to
administer the machine and the app.

You can do this like so:

```shell
awsbox addkey <name> /path/to/keyfile.rsa.pub
```

Where `<name>` is either the AWS instance identifier or your name for it.

The `addkey` command will add each key in the keyfile you give it,
excluding any that are already in the `authorized_keys` file.

Alternately, to only give app access, turn the symlink in
`~app/.ssh/authorized_keys` to a real file, and add your buddy's key
there:

    $ cp -L ~/.ssh/authorized_keys ~/.ssh/foo && mv .ssh/foo .ssh/authorized_keys
    $ # now add the key

## How Do I Revoke Other People's Access to the VM?

YOu can manually edit the `~ec2-user/.ssh/authorized_keys` file, or
use the `removekey` command like so:

```shell
awsbox removekey <name> /path/to/keyfile.rsa.pub
```

Where `<name>` is either the AWS instance id or your name for it.

## How Do I List the People Who Have Access to the VM?

Look in the `~ec2-user/.ssh/authorized_keys` file, or simply run:

```shell
awsbox listkeys <name>
```

Where `<name>` is your instance id or name.

## How Do I Enable SSL?

SSL is already enabled with a self signed SSL certificate.  You can update the
SSL credentials thusly:

    $ scp myprivatekey.pem proxy@[ip address]:key.pem
    $ scp mycert.pem proxy@[ip address]:cert.pem
    $ ssh ec2-user@[ip address] 'sudo /etc/init.d/nginx restart'

Note that if you procure an SSL certificate from someone other than
one of the root authorities (which in the ephemeral world of awsbox is
very likely), you'll need to concatenate your issuer's intermediate
cert with the cert they have granted you.  This enables the person
visting your site to see that you are trusted by the intermediate, and
the intermediate is trusted by a root.  Without the intermediate cert
in the chain, you are nobody.

You can concatenate the files quite simply into a single `.pem`:

    cat cert-yoursite.tld.crt > cert.pem
    cat GrantingAuthorityCert.pem >> cert.pem

Order matters - yours first, then theirs.

In the end, your `cert.pem` file should read like:

    -----BEGIN CERTIFICATE-----
    your cert blah blah blah
    -----END CERTIFICATE-----
    -----BEGIN CERTIFICATE-----
    intermediate cert herp derp derp herp derp
    -----END CERTIFICATE-----

## How Do I Disable SSL?

At creation time you can pass `--ssl=disable` to create the instance with SSL
disabled.

Post creation, you can SSH in as the proxy user, and remove the SSL nginx
configuration in `~proxy/conf.d/https.conf`

Then restart the proxy.

## How Do I Force Connections to use SSL?

You can always use HTTP headers (Strict-Transport-Security), but even then, a user's
first request will not be encrypted.  To cause all HTTP traffic to be redirected
to HTTPS, you can SSH in as the proxy user and re-configure nginx.

    mv conf.d/https_redirect.conf.disabled conf.d/https.conf

Then restart the proxy.

## How Do I Use WebSockets?

Because we use nginx > 1.3 for HTTP forwarding, it will Just Work.  Have a look at the
[socket.io example] for a tiny focused example which uses WebSockets via the excellent
socket.io library.

  [nginx]: http://nginx.com/news/nginx-websockets/
  [socket.io example]: https://github.com/lloyd/awsbox-socketio-example

## How Do I Install Software?

Use yum.

    $ ssh ec2-user@[ip address]
    $ yum search memcached
    $ yum install memcached.x86_64


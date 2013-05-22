## `.awsbox.json`

To use awsbox you must create an `.awsbox.json` in your repository which contains
information about how to run your service.  Multiple top level keys are supported
to allow you to configure how your service is run, what it depends on, and to
allow you to run scripts at different `hook` points during creation and deployment.

This file documents the supported keys.

### `.processes` (**required**)

An array of processes that should be started upon git push.  The first process in
the list will be public (external requests routed to it), others will be
"private".  Only the first entry in the list will have a `PORT` env var defined
at the time of execution and it must bind this port on localhost.

example:

    {
      "processes": [
        "bin/webserver.js",
        "bin/otherserver.js"
      ]
    }

### `.env` (**optional**)

A map of variables that will be injected into the environment at the time
your processes are run.

example:

    {
      "processes": [ "myscript.js" ],
      "env": {
        "CONFIG_FILES": "$HOME/code/config/production.json,$HOME/config.json"
      }
    }

### `.remote_hooks` (*optional*)

The remote_hooks key allows you to specify scripts that will run on
the server at various points during deployment.

example:

    {
      "processes": [ "myscript.js" ],
      "hooks": {
        "postdeploy": "scripts/awsbox/post_deploy.js",
        "poststart": "scripts/show_config.js",
        "postcreate": "scripts/awsbox/post_create.sh"
      }
    }


Available hooks include:

#### `postdeploy`

Run as the `app` user after every git push, after npm install of modules.

#### `poststart`

Run as the `app` user after every git push, after your server processes are
started.

#### `postcreate`

Run as the `ec2-user` immediately after the VM is created

### `.local_hooks` (*optional*)

The local_hooks key allows you to specify scripts that will run on
the client at various points during deployment.

#### `poststart`

Run locally as the current user after every git push.

#### `postcreate`

Run locally as the current user after the VM is created.

### `.packages` (*optional*)

An array of packages that should be installed via yum during VM creation.

example:

    {
      "processes": [ "myscript.js" ],
      "packages": [
        "mysql-server"
      ]
    }

### `.ami` (*optional*)

Use a custom AWS AMI base image. This defaults to "ami-8af096e3", a basic
Linux AMI with node 0.8.17 and all the magic that makes awsbox easy. It is
recommended to base new AMIs from the default and use `awsbox createami` for
customization.

example:

    {
      "ami": "ami-6f690106",
      "processes": [ "myscript.js" ]
    }

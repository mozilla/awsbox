## A Ludicrous Pace Tutorial

Want to try awsbox?  There are a couple things you have to do:

**0.** ``npm install awsbox``

**1.** Create an AWS account and put your `AWS_ID` and `AWS_SECRET` in corresponding
environment variables.

**2.** Generate an SSH RSA (not DSA) key with `ssh-keygen` if you don't already have one.

**3.** Add an `.awsbox.json` file to your project that specifies what processes to run

    {
      "processes": [ "server.js" ]
    }

**4.** add awsbox to your package.json as a dev dependency

    "devDependencies": {
      "awsbox": "*"
    }

    You need to add this manually to `package.json` if you skipped the `--save-dev` argument in in step 0 above.

**5.** set up your server to bind localhost and defer to the environment for PORT

    app.listen(process.env['PORT'] || 3000, '127.0.0.1');

**6.** Create a VM

    $ node_modules/.bin/awsbox create -n myvm

**7.** Deploy your code

    $ git push myvm HEAD:master

**8.** Check out your handiwork!

  Visit http://&lt;my ip address&gt; in your web browser.

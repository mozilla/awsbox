## A Ludicrous Pace Tutorial

Want to try awsbox?  There are a couple things you have to do:

**0.** ``npm install awsbox``

**1.** Create an AWS account and put your `AWS_ID` and `AWS_SECRET` in corresponding
environment variables.

**2.** Add an `.awsbox.json` file to your project that specifies what processes to run

    {
      "processes": [ "server.js" ]
    }

**3.** add awsbox to your package.json as a dev dependency

    "devDependencies": {
      "awsbox": "*"
    }

**4.** set up your server to bind localhost and defer to the environment for PORT

    app.listen(process.env['PORT'] || 3000, '127.0.0.1');

**5.** Create a VM

    $ node_modules/.bin/awsbox create -n myvm

**6.** Deploy your code

    $ git push myvm HEAD:master

**7.** Check out your handiwork!

  Visit http://&lt;my ip address&gt; in your web browser.

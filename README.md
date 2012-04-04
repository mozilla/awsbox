## A Lightweight DIY PaaS for Amazon Web Services

Amazon Web Services (AWS) "Elastic Compute Cloud" provides low cost, instant
on VMs that can be used to deploy any kind of service.  AWS also provides a
full set of APIs that make it possible to programatically allocate servers.
Finally, AWS offers the ability to create "template" instances (Amazon Machine
Images) that are VM snapshots.

*The problem:* For small scale nodejs projects, there's a lot of
administrative boiler plate work that one must to set up a machine.
You must install web server software, set up security policies and network
access, copy up your keypair, determine how you'll deploy your software on the
new VM, etc.

"Platform as a service" providers like heroku make most of these decisions for
you, providing a demand spun "vm-like" thing that you can deploy code on by
adhering to a couple conventions and `git pushing`.  Where heroku breaks down
is in *generativity* - you are limited to doing things that heroku has thought
of, and when you want to do something custom (install a new native software
library, run an experimental database for which you cannot find a third party
hosted provider) - you are screwed.

Also, heroku is relatively expensive.  The moment you want to run two
processes, you're paying 0.05$/hr for that process vs. on aws where
you can purchase a "micro" instance for 0.02$/hr for the whole VM.
The final area of expense is in "add-ons" - service providers that offer
things like hosted databases, email sending, etc.  A small scale database
can cost another .015$/hr.

So what we want is the convenience of Heroku, and the pricing and freedom
of amazon...

*The solution:* **awsbox** is a set of nodejs scripts, a command line utility,
and a template image (AMI).  Together it allows you to deploy a new server
from the command line that is pre-configured to run your Node.JS service.

## Features

  * **nodejs focused** - While other stacks could be supported in the future,
    awsbox is laser focused on node.js to start.
  * **full root access** - awsbox just gets you started, after that you can do
    Whatever You Want.
  * **magic ssh key config** - Your SSH key will be copied up and installed for you.
  * **git push support** - After you provision a vm, it's pre-configured so you can
    push to deploy
  * **command line or programmatic usage** - type at it, or script it.
  * **OS level user isolation** - all deployed code is run with user permissions under
    a single account.
  * **nginx forwarding with custom 503 page** - nginx is pre-configured to forward
    requests to your nodejs process bound to a local port.

## Get Started

Start by working through [the tutorial].  Then have a look at the [Hello World] sample app.
And after that, check out [the documentation] in this repository.

  [the tutorial]: https://github.com/lloyd/awsbox/master/doc/TUTORIAL.md
  [Hello World]: https://github.com/lloyd/awsbox-helloworld
  [the documentation]: https://github.com/lloyd/awsbox/master/doc/TUTORIAL.md

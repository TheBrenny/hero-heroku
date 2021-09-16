# TODO

A set of targets/milestone features that I'd like to see implemented into production, separated into [MUST HAVE](#must-have), [SHOULD HAVE](#should-have), [COULD HAVE](#could-have), and [WON'T HAVE](#wont-have). (See more at the [MoSCoW method](https://en.wikipedia.org/wiki/MoSCoW_method)).

## Must Have

- [x] View all owned apps
  - [ ] View all apps that the user has access to (needs to be confirmed)
- [x] View all owned pipelines
- [x] View the states of Dynos
- [x] Alter the states of Dynos (you can do this by scaling)
- [x] View what addons are connected to an app
- [x] Connect a one-off dyno to an app

## Should Have

- [x] View the app logs of specific Dynos
  - [ ] View any type of log for specific Dynos
  - [ ] Use the log terminal pane to switch
- [ ] Push and build an app (and view it's build log)
- [ ] Make more options configurable (such as dyno TTL)

## Could Have

- [ ] Set the context of the treeview to a particular app or pipeline
  - [ ] Make it persistent to the project (use `machine-overridable`?)

## Won't Have

(Yeah, this is an empty list for now)
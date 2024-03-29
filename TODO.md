# TODO

A set of targets/milestone features that I'd like to see implemented into production, separated into [MUST HAVE](#must-have), [SHOULD HAVE](#should-have), [COULD HAVE](#could-have), and [WON'T HAVE](#wont-have). (See more at the [MoSCoW method](https://en.wikipedia.org/wiki/MoSCoW_method)).

## Must Have

- [x] View all owned apps
  - [x] View all apps that the user has access to (needs to be confirmed)
- [x] View all owned pipelines
- [x] View the states of Dynos
- [x] Alter the states of Dynos (you can do this by scaling)
- [x] View what addons are connected to an app
- [x] Connect a one-off dyno to an app
- [ ] Trigger a build from the workspace root
  - [ ] This should only be available if the user has a `heroku` git remote
- [ ] Addon management
  - [ ] Provision new addons
  - [ ] Remove addons
- [ ] Fix the bug where the tree doesn't load in a timely manner
  - [ ] Even better: have it lazy load and show some tree item results as they respond

## Should Have

- [x] View the app logs of specific Dynos
  - [ ] View any type of log for specific Dynos
  - [ ] Use the log terminal pane to switch
- [ ] Push and build an app (and view it's build log)
- [ ] Make more options configurable (such as dyno TTL)
- [x] View the Config Vars for a specific app
  - [x] Be able to update those Config Vars
  - [ ] Edit Config Vars in a custom editor (maybe?)
    - This would allow us to hook into the save event without VSCode getting angry at us if the user doesn't want to actually save the file? (https://code.visualstudio.com/api/extension-guides/custom-editors#custom-text-editor)

## Could Have

- [ ] Set the context of the treeview to a particular app or pipeline
  - [ ] Make it persistent to the project (use `machine-overridable`?)
- [ ] Change the `dyno.create` command location to be an element in the Dyno Tree
- [ ] Better views (maybe WebViews) for responses from the server taht pretty much get piped directly to the user

## Won't Have

- (Yeah, this is an empty list for now)
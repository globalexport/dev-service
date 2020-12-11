#!/usr/bin/env node

const cli = require('commander')

const { version } = require('../src/constants')

const { portsUsed, error } = require('../src/utils')

cli
  .version(version)
  .arguments('[service]')
  .action(async (service) => {
    try {
      if (service) {
        await portsUsed(service)
      } else {
        await portsUsed()
      }
    } catch (e) {
      error(e)
    }
  })

cli.parse(process.argv)

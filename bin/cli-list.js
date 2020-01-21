#!/usr/bin/env node

const cli = require('commander')
const fs = require('fs-extra')

const { version, SERVICES_DIR } = require('../src/constants')

const { ensureServicesDir, error, run } = require('../src/helpers')

const list = async () => {
  ensureServicesDir(SERVICES_DIR)

  const files = fs.readdirSync(SERVICES_DIR)

  const params = []
  for (const f of files) {
    params.push('-f', f)
  }
  params.push('ps')

  await run('docker-compose', params, SERVICES_DIR)
}

cli.version(version).action(async () => {
  try {
    await list()
  } catch (e) {
    error(e)
  }
})

cli.parse(process.argv)

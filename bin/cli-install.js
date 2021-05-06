#!/usr/bin/env node

import cli from 'commander'
import path from 'path'
import fs from 'fs-extra'
import YAML from 'yaml'

import {
  version,
  TEMPLATES_DIR,
  SERVICES_DIR,
  COMPOSE_DIR
} from '../src/constants.js'

import {
  readPackageJson,
  escape,
  docker,
  error,
  resetComposeDir
} from '../src/utils.js'

/**
 * Helper methods
 */
const getName = (service) => {
  const [fullname] = service.split(':')
  const [name] = fullname.split('/').slice(-1)

  return name
}

const fillTemplate = (template, data) => {
  for (const key in data) {
    template = template.replace(new RegExp(`{{${key}}}`, 'g'), data[key])
  }

  return template
}

const ensureVolumes = async (content) => {
  const data = YAML.parse(content)
  if (!data || !data.volumes) return

  const volumes = []
  for (const key in data.volumes) {
    if (!data.volumes[key].external) continue

    const name = data.volumes[key].external.name
    if (!name) continue

    volumes.push(name)
  }

  await Promise.all(
    volumes.map((v) =>
      docker('volume', 'create', `--name=${v}`, '--label=keep')
    )
  )
}

const writeFile = (name, data) => {
  const dest = path.resolve(COMPOSE_DIR, `${name}.yml`)

  fs.writeFileSync(dest, data, { encoding: 'utf8' })
}

const copyAdditionalFiles = (name) => {
  const src = path.resolve(TEMPLATES_DIR, name)
  const dest = path.resolve(SERVICES_DIR, name)

  if (fs.existsSync(src) && !fs.existsSync(dest)) {
    fs.copySync(src, dest)
  }
}

const readServiceData = (service) => {
  if (typeof service === 'string') {
    return readStandardServiceData(service)
  } else if (typeof service === 'object') {
    return readCustomServiceData(service)
  }
}

const readCustomServiceData = (service) => {
  const image = service.image
  const name = getName(image)

  service.container_name = '{{container_name}}'

  const volumes = {}
  if (service.volumes) {
    for (const volume of service.volumes) {
      // Format: [SOURCE:]TARGET[:MODE]
      const volumeArray = volume.split(':')

      // volume is unnamed:
      if (volumeArray.length === 1) continue

      // => volume is named or mapped to a host path:
      const [volumeName] = volumeArray

      // volume has invalid volume name / volume is mapped to a host path
      // (@see https://github.com/moby/moby/issues/21786):
      if (!volumeName.match(/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/)) continue

      // volume is named => we add it to top level "volumes" directive:
      volumes[volumeName] = {
        external: {
          name: `{{projectname}}-${volumeName}`
        }
      }
    }
  }

  const templateObject = {
    version: '2.4',
    services: {
      [name]: service
    },
    volumes
  }

  const template = YAML.stringify(templateObject)

  return { name, image, template }
}

const readStandardServiceData = (service) => {
  const name = getName(service)
  const src = path.resolve(TEMPLATES_DIR, `${name}.yml`) // refactor with same line above

  const result = { image: service, name }

  const exists = fs.existsSync(src)
  if (exists) result.template = fs.readFileSync(src, { encoding: 'utf8' })

  return result
}

const serviceInstall = async (data, projectname) => {
  const content = fillTemplate(data.template, {
    image: data.image,
    container_name: `${projectname}_${data.name}`,
    projectname: projectname
  })

  await ensureVolumes(content)

  writeFile(data.name, content)

  copyAdditionalFiles(data.name)
}

const install = async () => {
  const { services: all, name } = readPackageJson()
  const projectname = escape(name)

  // cleanse services from falsy values:
  const services = all.filter((s) => s)

  // validate custom services:
  const invalid = services.filter((s) => typeof s === 'object' && !s.image)
  if (invalid.length > 0) {
    throw Error(
      `Invalid custom services:\n${invalid
        .map((i) => JSON.stringify(i, null, 2))
        .join(',\n')}`
    )
  }

  // create services data:
  const data = services.map(readServiceData)

  // exit if not all services' images are supported:
  const unsupported = data.filter((d) => !d.template).map((d) => d.name)
  if (unsupported.length > 0) {
    throw Error(`Unsupported services: ${unsupported.join(', ')}`)
  }

  // install services:
  resetComposeDir(COMPOSE_DIR)
  await Promise.all(data.map((d) => serviceInstall(d, projectname)))

  console.log(`Done (${services.length} services installed).`)
}

cli.version(version).action(async () => {
  try {
    await install()
  } catch (e) {
    error(e)
  }
})

cli.parse(process.argv)

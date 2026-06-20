import {describe, expect, test} from 'bun:test'
import {
    getComposeImageVariableNames,
    getRequiredComposeImageVariableNames,
    getServiceImageTemplate,
    inferComposeImageVariables,
} from './compose-image-vars'

test('reads the selected service image template from compose YAML', () => {
    const compose = `
version: "3.5"
services:
  boss_go:
    image: registry-vpc.cn-example.com/hzhf/boss_go:\${VERSION}
  worker:
    image: busybox:latest
`

    expect(getServiceImageTemplate(compose, 'boss_go')).toBe('registry-vpc.cn-example.com/hzhf/boss_go:${VERSION}')
})

describe('inferComposeImageVariables', () => {
    test('lists variables required by the image template', () => {
        expect(getComposeImageVariableNames('registry.example.com/app:${VERSION:?required}-${BUILD_ID:-local}')).toEqual([
            'VERSION',
            'BUILD_ID',
        ])
        expect(getRequiredComposeImageVariableNames('registry.example.com/app:${VERSION:?required}-${BUILD_ID:-local}')).toEqual([
            'VERSION',
        ])
    })

    test('infers VERSION from the current resolved container image', () => {
        const result = inferComposeImageVariables(
            'registry-vpc.cn-example.com/hzhf/boss_go:${VERSION:?VERSION is required}',
            'registry-vpc.cn-example.com/hzhf/boss_go:release-20260618103147',
        )

        expect(result).toEqual({VERSION: 'release-20260618103147'})
    })

    test('does not infer variables when the current image does not match the template', () => {
        const result = inferComposeImageVariables(
            'registry-vpc.cn-example.com/hzhf/boss_go:${VERSION}',
            'registry-vpc.cn-example.com/hzhf/other:release-20260618103147',
        )

        expect(result).toEqual({})
    })
})

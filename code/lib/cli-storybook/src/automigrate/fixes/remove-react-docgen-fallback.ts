import {
  isTypeScriptUsableForDocgen,
  readTypeScriptPackageForDocgen,
  typeScriptDocgenApisFor,
} from 'storybook/internal/common';
import { SupportedRenderer } from 'storybook/internal/types';

import * as pkg from 'empathic/package';
import { join } from 'pathe';
import picocolors from 'picocolors';
import { coerce } from 'semver';

import type { Fix } from '../types.ts';

// Why Storybook 11.0 added `react-docgen` to a project, as recorded in
// `temporary-dependencies.json`.
export const TYPESCRIPT_7_DOCGEN_FALLBACK_REASON = 'typescript-7.0-docgen-fallback';

// The unversioned Storybook cache file that records temporary dependencies, for the project whose
// package.json is in `projectDir` (in a monorepo, the workspace package, not the repository root).
export const getTemporaryDependenciesPath = (projectDir: string) =>
  join(
    pkg.cache('storybook', { cwd: projectDir }) ??
      join(projectDir, 'node_modules', '.cache', 'storybook'),
    'temporary-dependencies.json'
  );

interface RemoveReactDocgenFallbackResult {
  recordPath: string;
  // The other temporary dependencies the record lists, which stay recorded.
  otherRecords: Record<string, string>;
}

// Storybook 11.0 added `react-docgen` to React projects on TypeScript 7.0, which has no API for the
// docgen server, and recorded that in the Storybook cache:
//
//     node_modules/.cache/storybook/temporary-dependencies.json
//     { "react-docgen": "typescript-7.0-docgen-fallback" }
//
// Once the TypeScript docgen loads is 5.9, 6, or 7.1 and newer, the docgen server runs and builder
// docgen does not, so this fix offers to remove `react-docgen` again. That is the package
// `typescript.docgenSpecifier` names when the main config sets it, and `typescript` otherwise. It skips projects whose main
// config sets `features.docgenServer: false`, which need `react-docgen`. Without the record (a fresh
// clone, CI, `npm ci`, a deleted `node_modules`) it keeps `react-docgen`: the user may have added
// it, and an unused devDependency is harmless.
export const removeReactDocgenFallback: Fix<RemoveReactDocgenFallbackResult> = {
  id: 'remove-react-docgen-fallback',
  link: 'https://storybook.js.org/docs/configure/integration/typescript#typescript-7',

  async check({ packageManager, mainConfig, configDir, files }) {
    const recordPath = getTemporaryDependenciesPath(packageManager.primaryPackageJson.operationDir);
    let recorded: Record<string, string>;
    try {
      recorded = JSON.parse(await files.read(recordPath));
    } catch {
      return null;
    }
    const { 'react-docgen': reason, ...otherRecords } = recorded;
    if (
      reason !== TYPESCRIPT_7_DOCGEN_FALLBACK_REASON ||
      !(await packageManager.getDeclaredVersionSpecifier('react-docgen'))
    ) {
      return null;
    }
    const features = mainConfig.features as
      | { docgenServer?: boolean; experimentalDocgenServer?: boolean }
      | undefined;
    if ((features?.docgenServer ?? features?.experimentalDocgenServer) === false) {
      return null;
    }
    const apis = typeScriptDocgenApisFor(SupportedRenderer.REACT);
    const docgenSpecifier = (mainConfig.typescript as { docgenSpecifier?: string } | undefined)
      ?.docgenSpecifier;
    let version: string | undefined;
    if (docgenSpecifier) {
      if (!configDir) {
        return null;
      }
      try {
        ({ version } = readTypeScriptPackageForDocgen(
          { specifier: docgenSpecifier, configDir },
          apis
        ));
      } catch {
        return null;
      }
    } else {
      version = coerce(await packageManager.getDeclaredVersionSpecifier('typescript'))?.version;
    }
    return version && isTypeScriptUsableForDocgen(version, apis)
      ? { recordPath, otherRecords }
      : null;
  },

  prompt() {
    return `Storybook added ${picocolors.cyan('react-docgen')} to your project because server-side docgen could not run on TypeScript 7.0. Your TypeScript version is supported now, so Storybook no longer uses ${picocolors.cyan('react-docgen')}. Remove it from your devDependencies?`;
  },

  async run({ packageManager, result: { recordPath, otherRecords }, files }) {
    await packageManager.removeDependencies(['react-docgen']);
    if (Object.keys(otherRecords).length > 0) {
      files.write(recordPath, JSON.stringify(otherRecords, null, 2));
    } else {
      files.remove(recordPath);
    }
  },
};

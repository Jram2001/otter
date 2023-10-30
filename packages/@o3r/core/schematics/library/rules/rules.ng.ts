import type { PackageJson, TsConfigJson } from 'type-fest';
import type { NgGenerateModuleSchema } from '../schema';
import { findConfigFileRelativePath } from '@o3r/schematics';
import { apply, chain, externalSchematic, MergeStrategy, mergeWith, move, renameTemplateFiles, Rule, template, url } from '@angular-devkit/schematics';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { updateNgPackagrFactory, updatePackageDependenciesFactory } from './shared';
import { updateProjectTsConfig } from '../../rule-factories';

/**
 * generate the rules to adapt the library generated by ng cli
 * @param options.targetPath Path where the library has been generated
 * @param options Schematic options
 */
export function ngGenerateModule(options: NgGenerateModuleSchema & { targetPath: string; packageJsonName: string }): Rule {

  const relativeTargetPath = options.targetPath.replace(/^\//, '');

  /**
   * Update Ng templates
   * @param tree File tree
   * @param context Context of the schematics
   */
  const updateNgTemplate: Rule = (tree, context) => {
    const o3rCorePackageJsonPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
    const o3rCorePackageJson: PackageJson & { generatorDependencies?: Record<string, string> } = JSON.parse(readFileSync(o3rCorePackageJsonPath)!.toString());
    const otterVersion = o3rCorePackageJson.dependencies!['@o3r/schematics'];

    const templateNg = apply(url('./templates/ng'), [
      template({
        ...options,
        runner: process.env.npm_execpath && /[\\/][^\\/]yarn[^\\/]js$/.test(process.env.npm_execpath) ? 'yarn run' : 'npm run',
        tsconfigSpecPath: findConfigFileRelativePath(tree,
          ['tsconfig.test.json', 'tsconfig.spec.json', 'tsconfig.jest.json', 'tsconfig.jasmine.json', 'tsconfig.base.json', 'tsconfig.json'], options.targetPath),
        tsconfigBasePath: findConfigFileRelativePath(tree, ['tsconfig.base.json', 'tsconfig.json'], options.targetPath),
        tsconfigBuildPath: findConfigFileRelativePath(tree, ['tsconfig.build.json', 'tsconfig.base.json', 'tsconfig.json'], options.targetPath),
        eslintRcPath: findConfigFileRelativePath(tree, ['.eslintrc.json', '.eslintrc.js'], options.targetPath)
      }),
      renameTemplateFiles(),
      move(options.targetPath)
    ]);

    return chain([
      mergeWith(templateNg, MergeStrategy.Overwrite),
      updatePackageDependenciesFactory(options.targetPath, otterVersion!, o3rCorePackageJson, options),
      updateNgPackagrFactory(options.targetPath),
      (t) => {
        const genPackageJsonPath = path.posix.join(options.targetPath, 'package.json');
        const packageJson = t.readJson(genPackageJsonPath) as PackageJson;
        packageJson.name = options.packageJsonName;
        t.overwrite(genPackageJsonPath, JSON.stringify(packageJson, null, 2));
        return t;
      }
    ])(tree, context);
  };

  /**
   * Update the root tsconfig files mappings
   * @param tree File tree
   * @param context Context of the schematics
   */
  const updateTsConfigFiles: Rule = (tree, context) => {
    const tsconfigBase = findConfigFileRelativePath(tree, ['tsconfig.base.json', 'tsconfig.json'], '/');
    const tsconfigBuild = findConfigFileRelativePath(tree, ['tsconfig.build.json'], '/');
    if (tsconfigBase) {
      const configFile = tree.readJson(tsconfigBase) as TsConfigJson;
      if (configFile?.compilerOptions?.paths) {
        configFile.compilerOptions.paths = Object.fromEntries(
          Object.entries(configFile.compilerOptions.paths).filter(([pathName, _]) => pathName !== options.name));
        configFile.compilerOptions.paths[options.packageJsonName] = [
          path.posix.join(relativeTargetPath, 'dist'),
          path.posix.join(relativeTargetPath, 'src', 'public-api')
        ];
        tree.overwrite(tsconfigBase, JSON.stringify(configFile, null, 2));
      } else {
        context.logger.warn(`${tsconfigBase} does not contain path mapping, the edition will be skipped`);
      }
    } else {
      context.logger.warn('No base TsConfig file found');
    }

    if (tsconfigBuild) {
      const configFile = tree.readJson(tsconfigBuild) as TsConfigJson;
      if (configFile?.compilerOptions?.paths) {
        configFile.compilerOptions.paths = Object.fromEntries(
          Object.entries(configFile.compilerOptions.paths).filter(([pathName, _]) => pathName !== options.name));
        configFile.compilerOptions.paths[options.packageJsonName] = [
          path.posix.join(relativeTargetPath, 'dist'),
          path.posix.join(relativeTargetPath, 'src', 'public-api')
        ];
        tree.overwrite(tsconfigBuild, JSON.stringify(configFile, null, 2));
      } else {
        context.logger.warn(`${tsconfigBuild} does not contain path mapping, the edition will be skipped`);
      }
    }
  };

  const ngCliUpdate: Rule = (tree, context) => {
    return chain([
      (t, c) => externalSchematic('@schematics/angular', 'library', {
        name: options.name,
        projectRoot: relativeTargetPath,
        prefix: options.prefix
      })(t, c),
      updateNgTemplate,
      updateProjectTsConfig(options.targetPath, 'tsconfig.lib.json', {updateInputFiles: true}),
      updateTsConfigFiles
    ])(tree, context);
  };

  return ngCliUpdate;
}

import path from "path";
import fs from "fs";
import {spawn} from "child_process";

export class UiEmulatorUtils {

    private static loadJsonConfig(rootDir: string, name: string) {
        const jsonPath = path.resolve(rootDir, name);
        if (!fs.existsSync(jsonPath)) {

            return null;
        }
        const fileContent = fs.readFileSync(jsonPath).toString();
        return JSON.parse(fileContent);
    }

    private static storeJsonConfig(rootDir: string, name: string, content: any) {
        const jsonPath = path.resolve(rootDir, name);
        fs.writeFileSync(jsonPath, JSON.stringify(content, null, 2));
    }

    private static discoverPluginModule(packageRoot: string, elementsRootRelativePath: string, elementFolderName: string) {

        const baseAbs = path.join(packageRoot, path.join(elementsRootRelativePath, elementFolderName));
        const angularJson = this.loadJsonConfig(baseAbs, 'angular.json');
        const modulePath = angularJson.projects[angularJson.defaultProject].architect.build.options.modulePath;
        const modulePathTokens = modulePath.split(path.sep);
        const fileAndModule = modulePathTokens.slice(1).join(path.sep);
        let file = fileAndModule.split('#')[0];
        if (file.includes('.ts')) {
            file = file.split('.').slice(0, -1).join('.');
        }
        const module = fileAndModule.split('#')[1];
        const srcRoot = path.join(elementFolderName, 'src');
        return {
            elementsRootRelativePath,
            srcRoot,
            file,
            module
        };
    }

    /**
     * Configures and serves the ui-emulator angular application, hosting provided ui plugin elements.
     * @param uiEmulatorConfigRoot - absolute root path to ui plugin folder
     * @param elementsRootRelativePath - relative path to root dir containing all plugin folders
     * @param elementFolderNames - all ui plugin folders
     * @param vcdConfig - VCD Configuration object
     */
    public static async serve(uiEmulatorConfigRoot: string,
                              elementsRootRelativePath: string,
                              elementFolderNames: string[],
                              vcdConfig: {
                                  token: string, cellUrl: string
                              }
    ) {

        const rootDir = path.join(uiEmulatorConfigRoot, '.env'); // Extract as optional parameter?
        const angularJson = this.loadJsonConfig(uiEmulatorConfigRoot, 'angular.json');
        const tsconfigJson = this.loadJsonConfig(uiEmulatorConfigRoot, 'tsconfig.emulator.json');
        const environment = this.loadJsonConfig(rootDir, 'environment.json');
        const proxyConfig = this.loadJsonConfig(rootDir, 'proxy.conf.json');
        let pluginsConfig = [];
        try {
            console.log('Setting auth token');

            environment.credentials = {
                token: `Bearer ${vcdConfig.token}`
            };
            console.log('Updating proxy config');
            Object.keys(proxyConfig).forEach(key => {
                proxyConfig[key].target = vcdConfig.cellUrl;
            });
            console.log('Updating Plugins');
            const pluginModules =
                elementFolderNames.map(
                    element => this.discoverPluginModule(uiEmulatorConfigRoot, elementsRootRelativePath, element)
                );

            pluginsConfig = pluginModules.map(pm => {
                return {
                    label: pm.module,
                    root: path.join(pm.elementsRootRelativePath, pm.srcRoot),
                    module: `${pm.file}#${pm.module}`,
                    assetsPath: path.join(pm.srcRoot, "public/assets")
                };
            });

            console.log('Updating angular.json');
            angularJson.projects.emulator.architect.build.options.assets = [
                'node_modules/@vcd/ui-emulator/src/favicon.ico',
                ...pluginModules.map(pm => {
                    return {
                        glob: '**/*',
                        input: `./${path.join(pm.elementsRootRelativePath, pm.srcRoot)}/public`,
                        output: `/${pm.srcRoot}/public`
                    };
                })
            ];
            angularJson.projects.emulator.architect.build.options.lazyModules = pluginModules.map(pm => path.join(path.join(pm.elementsRootRelativePath, pm.srcRoot), pm.file));
            console.log('Updating tsconfig.emulator.json');
            tsconfigJson.include = [
                '.env/*.json',
                'node_modules/@vcd/ui-emulator/src/**/*.ts',
                ...pluginModules.map(pm => path.join(path.join(pm.elementsRootRelativePath, pm.srcRoot), '**', '*.ts'))
            ];
        } catch (e) {
            console.log('Error configuring environment.', e);
        } finally {
            this.storeJsonConfig(rootDir, 'environment.runtime.json', environment);
            this.storeJsonConfig(rootDir, 'proxy.conf.runtime.json', proxyConfig);
            this.storeJsonConfig(rootDir, 'plugins.json', pluginsConfig);
            this.storeJsonConfig(uiEmulatorConfigRoot, 'angular.json', angularJson);
            this.storeJsonConfig(uiEmulatorConfigRoot, 'tsconfig.emulator.json', tsconfigJson);
        }
        spawn('ng', ['serve'], {
            cwd: uiEmulatorConfigRoot,
            stdio: 'inherit'
        });
        return Promise.resolve();
    }
}
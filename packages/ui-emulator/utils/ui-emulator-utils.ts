import path from "path";
import fs from "fs";
import {spawn} from "child_process";
import {CloudDirectorConfig} from '@vcd/node-client';
import inquirer from "inquirer";

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
     * @param serveArgs - Arguments passed to ng serve
     */
    public static async serve(uiEmulatorConfigRoot: string,
                              elementsRootRelativePath: string,
                              elementFolderNames: string[],
                              vcdConfig: {
                                  token: string, cellUrl: string
                              },
                              serveArgs?: string[]
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
        spawn('ng', ['serve', ...(serveArgs ? serveArgs : [])], {
            cwd: uiEmulatorConfigRoot,
            stdio: 'inherit'
        });
        return Promise.resolve();
    }
}

export class VcdAuth {

    /**
     * Prompts the user to select particular VCD auth configuration from the store
     * @param vcdAuthFile - path to the VCD authentication store file
     */
    public static async use(vcdAuthFile: string) {

        const configs = CloudDirectorConfig.getConfigurations(vcdAuthFile);

        if (configs.configurations.length <= 0) {
            console.log("No VCD Authentication Configurations stored yet!");
            return;
        }

        const answers = await inquirer.prompt({
            type: 'list',
            name: 'alias',
            message: 'Select configuration',
            default: configs.current,
            loop: false,
            choices: configs.configurations.map((element) => {
                return {
                    name: `${element.key}: ${element.username}/${element.org} ${element.basePath}`,
                    value: element.key
                };
            }),
        });
        CloudDirectorConfig.use(answers.alias, vcdAuthFile);

        return await this.getCloudDirectorConfig(vcdAuthFile);
    }

    /**
     * Returns current VCD Auth configuration
     * @param vcdAuthFile - path to the VCD authentication store file
     */
    public static async getCloudDirectorConfig(vcdAuthFile: string): Promise<CloudDirectorConfig> {
        let config = CloudDirectorConfig.fromFile(vcdAuthFile);
        if (!config.connectionAuth.authorized && config.connectionAuth.authorizationError === 'Token expired') {
            const answers = await inquirer.prompt({
                type: 'password',
                name: 'password',
                message:
                    `Token has expired. Please enter the password for ${config.authentication.username}@${config.authentication.org} again: `,
            });
            const password = answers.password;
            config = await this.loginAndStore(
                CloudDirectorConfig.getConfigurations().current,
                config.basePath, config.authentication.username, config.authentication.org, password, vcdAuthFile);
        }
        return config;
    }

    /**
     * Creates a new VCD Auth configuration and stores it VCD authentication store file
     * @param alias - alias use for storing
     * @param vcdHost - Cloud director host
     * @param user - username
     * @param org - organization
     * @param password - password
     * @param vcdAuthFile - path to the VCD authentication store file
     */
    public static async loginAndStore(alias: string, vcdHost: string, user: string, org: string, password: string, vcdAuthFile: string) {
        const config = await CloudDirectorConfig.withUsernameAndPassword(
            vcdHost,
            user,
            org,
            password
        );
        if (!config.connectionAuth.authorized) {
            console.warn('Connection error: ' + config.connectionAuth.authorizationError);
            console.log(config.connectionAuth.certificate);
            const answers = await inquirer.prompt({
                type: 'confirm',
                name: 'accept',
                message: 'Do you accept the provided certificate?',
            });
            config.connectionAuth.authorized = answers.accept;
        }
        config.saveConfig(alias, vcdAuthFile);
        return config;
    }
}
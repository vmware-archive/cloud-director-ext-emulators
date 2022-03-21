export class PluginRegistration {
    label: string;
    root: string;
    module: string;
    assetsPath: string;

    constructor(root: string, module: string, label: string, assetsPath: string) {
        this.root = root;
        this.module = module;
        this.label = label;
        this.assetsPath = assetsPath;
    }

    get path(): string {
        return this.module.split('#')[1];
    }
}

import plugins from '.env/plugins.json';
export const PLUGINS: PluginRegistration[] = plugins.map(p => {
    return new PluginRegistration(p.root, p.module, p.label, p.assetsPath);
});

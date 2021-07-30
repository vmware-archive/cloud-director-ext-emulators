const fs = require('fs');
const path = require('path');

const ignoredFolders = ['.github', '.gradle', '.idea', '.git', 'node_modules'];
const generatedFilePath = __dirname + '/dependencies.json';

async function generateFileHelper(currentDir, components) {
    try {
        const files = await fs.promises.readdir(currentDir);

        for (const file of files) {
            const filePath = path.join(currentDir, file);
            if (file === 'package-lock.json') {
                const fileContent = await fs.readFileSync(filePath);
                const parsedContent = JSON.parse(fileContent);
                addDependencies(parsedContent, components);
            } else {
                // Stat the file to see if we have a file or dir
                const stat = await fs.promises.stat(filePath);

                if (stat.isDirectory() && !ignoredFolders.includes(file)) {
                    await generateFileHelper(filePath, components);
                }
            }
        }
    } catch (e) {
        console.error("Could not generate dependencies for project.", e);
    }
}

function addDependencies(packageJson, components) {
    const dependencies = packageJson.dependencies;
    for (const [key, value] of Object.entries(dependencies)) {
        components.add(value.resolved);
    }
}

function generateResult() {
    return {
        id: 'http://vmware.com/schemas/software_provenance-0.2.0.json',
        root: 'latest',
        'all-components': {
            name: 'cloud-director-ext-emulators',
            version: 'latest',
            'source_repositories': [
                {
                    content: "source",
                    host: "github.com",
                    protocol: "git",
                    paths: [
                        "/vmware/cloud-director-ext-emulators"
                    ],
                    branch: 'master'
                },
            ],
            components: {},
            'artifact_repositories': []
        }
    };
}


(async () => {
    // first we scan all package-lock.json files to get the dependencies
    const components = new Set();
    await generateFileHelper(__dirname.substr(0, __dirname.indexOf('.github/workflows')), components);

    // map it to a key-value object, where the key is the host and the value is a list of
    // dependencies
    const hostPathPairs = [...components].reduce((map, resolvedUrl) => {
        const url = new URL(resolvedUrl);
        let values = map[url.host];
        if (!values) {
            values = [];
            map[url.host] = values;
        }
        values.push(resolvedUrl.substr(resolvedUrl.indexOf(url.host) + url.host.length));
        return map;
    }, {});

    // generate a template of the result
    const result = generateResult();

    // populate the data
    const artifactRepos = result['all-components']['artifact_repositories'];
    for (const [key, value] of Object.entries(hostPathPairs)) {
        const artifactRepo = {
            content: 'binary',
            host: key,
            path: value
        }
        artifactRepos.push(artifactRepo);
    }

    // delete the generated file if exists
    if (fs.existsSync(generatedFilePath)) {
        fs.unlinkSync(generatedFilePath);
    }

    // create the file
    const writeStream = fs.createWriteStream(generatedFilePath);
    writeStream.write(JSON.stringify(result));
    writeStream.close();
})();


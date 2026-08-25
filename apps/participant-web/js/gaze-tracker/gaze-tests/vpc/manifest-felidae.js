function buildLocalEntry({
    species,
    fileName,
    assetName,
    sourcePage,
    author,
    license,
    licenseUrl = ''
}) {
    return {
        species,
        fileName,
        stimulusId: `${species}:${assetName}`,
        url: `assets/vpc/felidae/${assetName}`,
        sourcePage,
        author,
        license,
        licenseUrl
    };
}

export const FELIDAE_SPECIES_POOLS = Object.freeze({
    lion: [
        buildLocalEntry({
            species: 'lion',
            fileName: 'Lion (Panthera Leo).jpg',
            assetName: 'lion.jpg',
            sourcePage: 'https://commons.wikimedia.org/wiki/File:Lion_(Panthera_Leo).jpg',
            author: 'Stephanie cheks',
            license: 'CC BY-SA 4.0',
            licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0'
        })
    ],
    tiger: [
        buildLocalEntry({
            species: 'tiger',
            fileName: 'Panthera tigris tigris.jpg',
            assetName: 'tiger.jpg',
            sourcePage: 'https://commons.wikimedia.org/wiki/File:Panthera_tigris_tigris.jpg',
            author: 'John and Karen Hollingsworth; retouched by Zwoenitzer',
            license: 'Public domain'
        })
    ],
    leopard: [
        buildLocalEntry({
            species: 'leopard',
            fileName: 'Leopard panthera pardus.jpg',
            assetName: 'leopard.jpg',
            sourcePage: 'https://commons.wikimedia.org/wiki/File:Leopard_panthera_pardus.jpg',
            author: 'Charles J. Sharp',
            license: 'CC BY-SA 3.0',
            licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0'
        })
    ],
    cheetah: [
        buildLocalEntry({
            species: 'cheetah',
            fileName: 'Cheetah (Acinonyx jubatus).jpg',
            assetName: 'cheetah.jpg',
            sourcePage: 'https://commons.wikimedia.org/wiki/File:Cheetah_(Acinonyx_jubatus).jpg',
            author: 'cliff1066',
            license: 'CC BY 2.0',
            licenseUrl: 'https://creativecommons.org/licenses/by/2.0'
        })
    ],
    jaguar: [
        buildLocalEntry({
            species: 'jaguar',
            fileName: 'Jaguar, Panthera Onca.jpg',
            assetName: 'jaguar.jpg',
            sourcePage: 'https://commons.wikimedia.org/wiki/File:Jaguar,_Panthera_Onca.jpg',
            author: 'Eduardo Estrada, Wildlife & Conservation Photography',
            license: 'CC BY-SA 4.0',
            licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0'
        })
    ],
    lynx: [
        buildLocalEntry({
            species: 'lynx',
            fileName: 'Lynx lynx.jpg',
            assetName: 'lynx.jpg',
            sourcePage: 'https://commons.wikimedia.org/wiki/File:Lynx_lynx.jpg',
            author: 'Wikimedia Commons',
            license: 'Public domain'
        })
    ],
    puma: [
        buildLocalEntry({
            species: 'puma',
            fileName: 'Puma (Puma concolor).jpg',
            assetName: 'puma.jpg',
            sourcePage: 'https://commons.wikimedia.org/wiki/File:Puma_(Puma_concolor).jpg',
            author: 'Jbarreirol',
            license: 'CC BY-SA 3.0',
            licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0'
        })
    ],
    caracal: [
        buildLocalEntry({
            species: 'caracal',
            fileName: 'Cute caracal.jpg',
            assetName: 'caracal.jpg',
            sourcePage: 'https://commons.wikimedia.org/wiki/File:Cute_caracal.jpg',
            author: 'ZhanserikKT',
            license: 'CC BY 4.0',
            licenseUrl: 'https://creativecommons.org/licenses/by/4.0'
        })
    ],
    domestic_cat: [
        buildLocalEntry({
            species: 'domestic_cat',
            fileName: 'Felis catus1.jpg',
            assetName: 'domestic-cat.jpg',
            sourcePage: 'https://commons.wikimedia.org/wiki/File:Felis_catus1.jpg',
            author: 'Sbonfus',
            license: 'CC0',
            licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/'
        })
    ]
});

const TRIAL_PAIRS = [
    ['lion', 'tiger'],
    ['leopard', 'cheetah'],
    ['jaguar', 'puma'],
    ['lynx', 'caracal'],
    ['domestic_cat', 'lion'],
    ['tiger', 'leopard'],
    ['cheetah', 'jaguar'],
    ['puma', 'lynx'],
    ['caracal', 'domestic_cat'],
    ['lion', 'cheetah'],
    ['leopard', 'jaguar'],
    ['tiger', 'puma']
];

export const FELIDAE_TRIALS = Object.freeze(
    TRIAL_PAIRS.map((pair, index) => ({
        trialId: `vpc_${String(index + 1).padStart(2, '0')}`,
        familiarSpecies: pair[0],
        novelSpecies: pair[1],
        novelSide: index % 2 === 0 ? 'left' : 'right'
    }))
);

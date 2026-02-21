function buildCommonsEntry({
    species,
    fileName,
    author = 'Wikimedia Commons contributors',
    license = 'See source page (CC BY / CC BY-SA / Public Domain)',
    licenseUrl = 'https://commons.wikimedia.org/wiki/Commons:Licensing'
}) {
    const encodedName = encodeURIComponent(fileName);
    const pageName = fileName.replace(/ /g, '_');
    return {
        species,
        fileName,
        stimulusId: `${species}:${pageName}`,
        url: `https://commons.wikimedia.org/wiki/Special:FilePath/File:${encodedName}`,
        sourcePage: `https://commons.wikimedia.org/wiki/File:${pageName}`,
        author,
        license,
        licenseUrl
    };
}

export const FELIDAE_SPECIES_POOLS = Object.freeze({
    lion: [
        buildCommonsEntry({ species: 'lion', fileName: 'Lion (Panthera Leo).jpg' }),
        buildCommonsEntry({ species: 'lion', fileName: 'Panthera-leo.jpg' }),
        buildCommonsEntry({ species: 'lion', fileName: 'Panthera leo (55027011675).jpg' })
    ],
    tiger: [
        buildCommonsEntry({ species: 'tiger', fileName: 'Panthera tigris tigris.jpg' }),
        buildCommonsEntry({ species: 'tiger', fileName: 'Panthera tigris (TIGER).jpg' }),
        buildCommonsEntry({ species: 'tiger', fileName: '(PANTHERA TIGRIS) TIGER.jpg' })
    ],
    leopard: [
        buildCommonsEntry({ species: 'leopard', fileName: 'Leopard panthera pardus.jpg' }),
        buildCommonsEntry({ species: 'leopard', fileName: 'Panthera-pardus.jpg' }),
        buildCommonsEntry({ species: 'leopard', fileName: 'Panthera pardus pardus.jpg' })
    ],
    cheetah: [
        buildCommonsEntry({ species: 'cheetah', fileName: 'Cheetah (Acinonyx jubatus).jpg' }),
        buildCommonsEntry({ species: 'cheetah', fileName: 'Cheetah (Acinonyx jubatus), Maasai Mara.jpg' }),
        buildCommonsEntry({ species: 'cheetah', fileName: 'Cheetah African predator mammal animal acinonyx jubatus.jpg' })
    ],
    jaguar: [
        buildCommonsEntry({ species: 'jaguar', fileName: 'Jaguar, Panthera Onca.jpg' }),
        buildCommonsEntry({ species: 'jaguar', fileName: 'Panthera onca at the Toronto Zoo.jpg' })
    ],
    lynx: [
        buildCommonsEntry({ species: 'lynx', fileName: 'Lynx lynx.jpg' }),
        buildCommonsEntry({ species: 'lynx', fileName: 'Lynx-lynx.jpg' }),
        buildCommonsEntry({ species: 'lynx', fileName: 'Lynx lynx (Linnaeus 1758).jpg' })
    ],
    puma: [
        buildCommonsEntry({ species: 'puma', fileName: 'Puma (Puma concolor).jpg' }),
        buildCommonsEntry({ species: 'puma', fileName: 'Puma concolor 2.jpg' })
    ],
    caracal: [
        buildCommonsEntry({ species: 'caracal', fileName: 'Cute caracal.jpg' }),
        buildCommonsEntry({ species: 'caracal', fileName: 'Caracal (Caracal caracal).jpg' })
    ],
    domestic_cat: [
        buildCommonsEntry({ species: 'domestic_cat', fileName: 'Felis catus1.jpg' }),
        buildCommonsEntry({ species: 'domestic_cat', fileName: 'Cat November 2010-1a.jpg' })
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

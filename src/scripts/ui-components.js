(function () {
    globalThis.LBPlus = globalThis.LBPlus || {};

    globalThis.LBPlus.createServiceButton = function (id, labelText, modeText, tmdbId, isHidden = false) {
        const p = document.createElement('p');
        p.id = id;
        p.className = 'service -letterboxd-plus';
        if (isHidden) p.style.display = 'none';

        const labelLink = document.createElement('a');
        labelLink.className = 'label';
        labelLink.href = '#';
        labelLink.style.display = 'flex';
        labelLink.style.alignItems = 'center';

        const brand = document.createElement('span');
        brand.className = 'brand';
        const icon = document.createElement('img');
        icon.src = chrome.runtime.getURL('icon/icon16.png');
        icon.width = 24;
        icon.height = 24;
        brand.appendChild(icon);

        const title = document.createElement('span');
        title.className = 'title';
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = labelText;
        title.appendChild(name);

        labelLink.appendChild(brand);
        labelLink.appendChild(title);
        p.appendChild(labelLink);

        const options = document.createElement('span');
        options.className = 'options js-film-availability-options';
        const modeLink = document.createElement('a');
        modeLink.className = 'link';
        modeLink.href = '#';
        const extended = document.createElement('span');
        extended.className = 'extended';
        extended.textContent = modeText;
        modeLink.appendChild(extended);
        options.appendChild(modeLink);
        p.appendChild(options);

        const handleButtonClick = (e) => {
            e.preventDefault();
            const mode = modeText.toLowerCase().includes('no cache') ? 'no-cache' : 'cache';
            globalThis.LBPlus.createStreamSection(tmdbId, mode);
        };

        labelLink.addEventListener('click', handleButtonClick);
        modeLink.addEventListener('click', handleButtonClick);

        return p;
    };
})();

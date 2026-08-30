(() => {
  const ICONS = {
    player: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAZCAYAAAA14t7uAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAOdEVYdFNvZnR3YXJlAEZpZ21hnrGWYwAAAjZJREFUeAGdVV1y2jAQ3l0zmT7SR5rMNJyg7WsCro/QG0BOQDmBzQlCbkBvQG/gjpJMHrlB/ADkse5bA2NvV+FPNpLT+JthhLTaT59Wu2uECjwFwXme530C6DHz+csi4kz+z1br9aj98JC4fNFlWHa732UI5dd07ckBhmdKjW02si0ufD+S4bqKdOt8Pd8IgFcV6+tzlj2WllPO8ykSNSUUn2EXlp3yLPtydn8/M9caR0dlWWhOGWCy8rxhW6kUDjeaIHNvrw5xIMNVpWKJ7W84hCD5oFQbLFj6/uNOuRyenir13rQXYqzDYJCCqJqAC8xTQ11zeXHx0Un8FsihaZW9QPxXrmTOGTFwepZszycnf5zE7TjWxLGxFMwvL3tlTp3jEtfgoIDjre8eR1mRMY88Qw0RTRbdrp7/pE38vwpp3/SxvYW18srpVAWdjpIRV+V16+OtiHQ1TeF1THWO2wxY5SXl2ifEsFxpugkR87h1d/fD5etMt6dOJxDjJ9vJUtqQEwV6j8sfbYSSSmHh1auRYJ5HZfUF4rnvj+WKA6iHsZT/8Ii4IhMS6WyxxDrRE951Nz2WYGYIbkkjIQ2LuziWrhW1lPplOWzTV6QTWnI6at3ejtDWf+XVo1Mxwn9g0emEWoC59rxet0lIB3VJNbZ7C5+nd41Gj0rNJHkL6V6h52mffa+Q8HwjkWg+wgxqQDcgNCtVHpag2CoTqAkuKk5JPuEv19BlKkG/gZpAz7uBTUqmOjP+AbbPBTMrCldHAAAAAElFTkSuQmCC',
    calendar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAYCAYAAAD+vg1LAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAOdEVYdFNvZnR3YXJlAEZpZ21hnrGWYwAAAbVJREFUeAHtVU1OwkAUfjNtlCVbDItyArskhCbDCSw34AbEE4A3wBOoJ5AbgKEQlvUGjRLZdtvSmfFNbWvbNFEruPJLJu3MvPne77whUIEXy7J1gDv89QXnw/Zm4+b394wZUogFSAlCiGl7vX4oc5Dywr7bNeTZmTpkqLkkxKVCzPMyklIb981k6gWHw6Cz3XqVxPt+nwEhEwnAoA7QgCAMh6mCmDhx/RGOAAzNSIWG5OJlwBGAHvuhpnWo5HxcIJVyqdzKLACYAedGYai1TFwq2SwHGIJmI4rGOpIwld0E3oXjDGIvUCEe8tuOc1Nh2PXOsp4pwGUYRbfQaPjnnDNcbyZW2+TNsmTeDRR2oV4IzByxr+c3lRu1q6LEQ+FE0IuqiIf14kEdUGrki6AYCiHuW9XJ+hJ4wSZ4S6eZHjgR/on/mBiz2oSaKJ+lRNXuJ0yoDyNTolpD0p1SsF2v92Py5IydzvFKL8krvhwaIYuS7JwUFVZCuY8kZrm/4EUbxS8IdjhFzOAYwH6uWm+cvEDThvhZwm+BpIGuK67iK43Ne4SaruDD+u9WiIfDRaJZa7V6ShffAQRowEv1ITcPAAAAAElFTkSuQmCC',
    like: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAYAAAByDd+UAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAOdEVYdFNvZnR3YXJlAEZpZ21hnrGWYwAAAaVJREFUeAG9lotxgzAMhkUvA2SDkgnKBmWEdIKkE7TdgA2SDUgmaDegnSBsABtAJ1ClYAdhMBgu7nenRNhnyf79BFgAIiZkBTZcyN7BFxQ8w2ESuDc8EhwnhntBwUIj+CdZpCTVvE3FeQB3MuGXZB9BEOTK16yngqxU7yP625FFRv2Jgp7V/ISiPKHyUvmyPIcplCzVyLwcjO/UaC+JXBJm6E7Bc2l0VuIkaSy+eT/Vyk+gK9e1TEjJyATcbktJjSbX8vzWzujhI9hHnpqRBkY4RjInYSGlNJJe0J3dCtw4GlJKXsh4/9kWTAjt1OxdR7iDhVDbrYhTzdn4S5ELq/yPhFKdb68J1UKLRdHZ9whj4Zd89vpOKOX84h9vCYfk9JoQBuT0nbCzOm+e48av5mx+7L8OnnUdH218muvN+UqVpfJDEYPrT1S3IWkSmCYWPsv5A5aRuFCg5SBX8WJsn5BM55YJsLmlM7C/R45kW+jfjTW0d6dmPRBn0zv4leYHNVptqdQe+08NFxYf+jrp3pDLRiY7KwlgAdi8XZ4Gqn6hWSS1re0fODALqmztmS8AAAAASUVORK5CYII=',
    dislike: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAYAAAByDd+UAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAOdEVYdFNvZnR3YXJlAEZpZ21hnrGWYwAAAZNJREFUeAG9loF1gjAQhn98HYANZAQ3qJ1AN9Bu0E4AnaBugJ3AboBuUCeIG8gG14uEviMNcIj6vXePkFz4Lz8xCAQgooTjk8NQO3Yst7kYQBQQm/Gl4Iiho+T4iKJo4+bbeStv/pHHv9Gysq5VdWEdeaNuR2JfMBcJZ46UY9oSaxpeXOoLGjG4Qg/U7ohxxdvYyX45ee5NSqCEKjsluVdUzXki5i1Ee88v+QQlnPvOl40iNZaCS9HeYjhHTdJFkKqfQiL6D7gT9QrlBhlk57WCY+3UCz7SzosgHmhnLTgX91vcGSs4E/eqrT2GJ1SnfX2o2hNj35J7Yru/MBaqDmgtWcdzjOJoo7ozJz3TgFjm5bQKRmLgGdUGSgILWIv2nK09yAfyxXj5e45X17bjhWuX6IMfGHvVx96YIT3FBP3IXVzy6mSVGZqO/KCbLfqg6sv+V6Ho97+fqXtfeWDVBccSGqj5cd25Pt9KAyUaS0NkaFr5glvB1S+omxS3xr2DEGorhwrG9P9wsEVo/yyPEp6NEfoFGD46PQ5iwxIAAAAASUVORK5CYII='
  };

  const icon = (name, cls) => `<img class="${cls}" src="${ICONS[name]}" alt="" aria-hidden="true">`;

  function decorate(card) {
    if (!card || card.querySelector('.moderation-reactions-figma')) return;
    const side = card.querySelector('.moderation-card-side');
    if (!side) return;
    const players = side.querySelector('.moderation-players');
    const release = side.querySelector('.moderation-release');
    if (players && !players.querySelector('img')) players.innerHTML = `${icon('player','moderation-fact-icon')}<span>${players.textContent.trim()}</span>`;
    if (release && !release.querySelector('img')) release.innerHTML = `${icon('calendar','moderation-fact-icon')}<span>${release.textContent.trim()}</span>`;
  }

  const apply = () => document.querySelectorAll('.moderation-card').forEach(decorate);
  apply();
  new MutationObserver(apply).observe(document.body,{childList:true,subtree:true});
})();
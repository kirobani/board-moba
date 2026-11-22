'use strict';

async function getJSON(url, body) {
  const options = body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {};
  const result = await fetch(url, options);
  const value = await result.json();
  if (!result.ok) throw new Error(value.error || '读取失败');
  return value;
}

async function sandbox(form) {
  const button = form.querySelector('button');
  const message = document.getElementById('sandbox-message');
  const {programs, sandboxes} = await getJSON('/api/arena');
  for (const side of ['A', 'B']) {
    for (const program of programs) form.elements[side].add(new Option(program.name, program.id));
  }
  if (programs.length) form.elements.B.value = programs[0].id;
  for (const game of sandboxes) {
    const link = document.createElement('a');
    link.href = '/sandbox.html?id=' + encodeURIComponent(game.id);
    link.textContent = game.name + ' · ' + game.status;
    const item = document.createElement('li');
    item.append(link);
    document.getElementById('sandbox-games').append(item);
  }
  button.disabled = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    button.disabled = true;
    message.textContent = '';
    try {
      const game = await getJSON('/api/sandboxes', {...Object.fromEntries(new FormData(form)), ruleset: 's16'});
      location.href = '/sandbox.html?id=' + encodeURIComponent(game.id);
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
  });
}

async function scores(target) {
  const rows = await getJSON('/results/teams.json');
  const tally = value => [value.win, value.loss, value.draw].join('–');
  const formatTime = new Intl.NumberFormat('zh-CN', {minimumIntegerDigits: 2});
  for (const team of rows) {
    const row = target.insertRow();
    const seconds = Math.round(team.devMs / 1000);
    const duration = [Math.floor(seconds / 60), seconds % 60].map(value => formatTime.format(value)).join(':');
    const values = [team.rank, team.label, team.points, tally(team.scores.standard), tally(team.scores.pressure), duration,
      ['top', 'jungle', 'mid', 'adc', 'support'].map(role => team.playerIds[role]).join(' / ')];
    for (const value of values) row.insertCell().textContent = value;
  }
}

const form = document.getElementById('sandbox-form');
if (form) sandbox(form).catch(error => {document.getElementById('sandbox-message').textContent = error.message;});
const table = document.getElementById('score-rows');
if (table) scores(table).catch(error => {document.getElementById('scores-message').textContent = error.message;});

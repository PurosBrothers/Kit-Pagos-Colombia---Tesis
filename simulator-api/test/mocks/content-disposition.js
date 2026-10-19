/* eslint-disable no-undef */
function create(filename, options) {
  const type = (options && options.type) || 'attachment';
  if (!filename) return type;
  return `${type}; filename="${filename}"`;
}

function parse(_header, _options) {
  return { type: 'attachment', parameters: {} };
}

module.exports = {
  create,
  parse,
  default: { create, parse },
};


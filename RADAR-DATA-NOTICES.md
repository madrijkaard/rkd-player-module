# Nomes e coordenadas das cidades

`src/ui/radar-cities.json` é uma adaptação de **GeoNames cities5000**,
obtida em 13 de setembro de 2026.

- Fonte: https://download.geonames.org/export/dump/cities5000.zip
- Autor: GeoNames — https://www.geonames.org/
- Licença: Creative Commons Attribution 4.0 — https://creativecommons.org/licenses/by/4.0/
- Alterações: seleção de localidades habitadas, remoção de bairros e de campos
  não utilizados, coordenadas arredondadas a quatro casas e conversão para JSON.

A base abrange cidades com mais de 5 mil habitantes e determinadas sedes
administrativas; não é uma lista completa de todos os municípios ou bairros.
Os dados são disponibilizados sem garantia de precisão, atualidade ou completude.
O script `scripts/import-radar-cities.cjs` permite regenerar o arquivo a partir
da extração original. A seleção das cidades próximas ocorre localmente.

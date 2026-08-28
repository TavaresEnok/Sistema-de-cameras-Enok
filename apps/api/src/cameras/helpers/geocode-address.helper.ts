export type GeocodedAddress = {
  displayName: string;
  latitude: number;
  longitude: number;
};

// ESTIMATIVA POR IP FOI REMOVIDA EM 28/08/2026.
//
// `isPublicIpForGeolocation` e `parseIpGeocodeResult` viviam aqui e punham no
// mapa a posição do provedor de internet — não a da câmera. Efeito medido nesta
// frota: 25 câmeras na MESMA coordenada, com sete casas decimais iguais, num
// bairro onde nenhuma delas está.
//
// Num mapa de segurança, pino errado é pior que pino nenhum: manda gente ao
// lugar errado com ar de certeza. Câmera sem endereço agora fica SEM posição, e
// o mapa diz quantas estão assim.
//
// Há teste que impede o retorno disto (geocode-address.test.ts).

/**
 * Converte a resposta do geocodificador em um contrato pequeno e validado.
 * A API externa nunca decide diretamente o que será persistido.
 */
export function parseGeocodeResult(payload: unknown): GeocodedAddress | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const first = payload[0] as Record<string, unknown>;
  const latitude = Number(first.lat);
  const longitude = Number(first.lon);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  const displayName = typeof first.display_name === 'string' ? first.display_name.trim() : '';
  return { displayName, latitude, longitude };
}

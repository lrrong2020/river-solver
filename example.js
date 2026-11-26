import { parseRange } from './engine/cards.js';

export function exampleSpot() {
  return {
    board: 'Ks 9d 6s 2h 2c',
    pot: 20,
    stack: 60,
    ranges: [
      parseRange('66,99,TT,JJ,KQs,KJs,KTs,KQo,A9s,T9s,98s,87s,AsQs,AsJs'),
      parseRange('AA,KK,99,66,AKs,AKo,KQs,KJs,QJs,JTs,87s,A5s,A4s')
    ],
    seats: [
      { bets: [50, 100], raises: [3], allIn: false },
      { bets: [50, 100], raises: [3], allIn: false }
    ],
    raiseCap: 1
  };
}

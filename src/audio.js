// Every sound is synthesised live with WebAudio: no audio files needed.

const PENTA = [ 0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24 ];
const noteHz = ( n, base = 523.25 ) => base * Math.pow( 2, n / 12 );

export class CandyAudio {

	constructor() {

		this.ctx = null;
		this.muted = false;
		this.musicOn = false;
		this.tempo = 1;
		this._step = 0;
		this._note = 4;

	}

	unlock() {

		if ( this.ctx ) {

			if ( this.ctx.state === 'suspended' ) this.ctx.resume();
			return;

		}

		const ctx = this.ctx = new AudioContext();
		this.master = ctx.createGain();
		this.master.gain.value = this.muted ? 0 : 0.55;

		// Soft echo so everything sounds like a music box in a big hall.
		const delay = ctx.createDelay( 1 );
		delay.delayTime.value = 0.27;
		const fb = ctx.createGain();
		fb.gain.value = 0.32;
		const wet = ctx.createGain();
		wet.gain.value = 0.3;
		const lp = ctx.createBiquadFilter();
		lp.frequency.value = 3200;
		this.master.connect( ctx.destination );
		this.master.connect( delay );
		delay.connect( lp );
		lp.connect( fb );
		fb.connect( delay );
		lp.connect( wet );
		wet.connect( ctx.destination );

		const len = ctx.sampleRate * 1.2;
		this.noise = ctx.createBuffer( 1, len, ctx.sampleRate );
		const d = this.noise.getChannelData( 0 );
		for ( let i = 0; i < len; i ++ ) d[ i ] = Math.random() * 2 - 1;

	}

	setMuted( m ) {

		this.muted = m;
		if ( this.master ) this.master.gain.setTargetAtTime( m ? 0 : 0.55, this.ctx.currentTime, 0.05 );

	}

	tone( freq, dur, { type = 'sine', vol = 0.25, slide = null, when = 0, attack = 0.005 } = {} ) {

		if ( ! this.ctx ) return;
		const t = this.ctx.currentTime + when;
		const o = this.ctx.createOscillator();
		const g = this.ctx.createGain();
		o.type = type;
		o.frequency.setValueAtTime( freq, t );
		if ( slide ) o.frequency.exponentialRampToValueAtTime( slide, t + dur );
		g.gain.setValueAtTime( 0, t );
		g.gain.linearRampToValueAtTime( vol, t + attack );
		g.gain.exponentialRampToValueAtTime( 0.0001, t + dur );
		o.connect( g ).connect( this.master );
		o.start( t );
		o.stop( t + dur + 0.05 );

	}

	noiseHit( dur, { vol = 0.3, from = 800, to = 200, type = 'lowpass', when = 0, q = 1 } = {} ) {

		if ( ! this.ctx ) return;
		const t = this.ctx.currentTime + when;
		const s = this.ctx.createBufferSource();
		s.buffer = this.noise;
		const f = this.ctx.createBiquadFilter();
		f.type = type;
		f.Q.value = q;
		f.frequency.setValueAtTime( from, t );
		f.frequency.exponentialRampToValueAtTime( to, t + dur );
		const g = this.ctx.createGain();
		g.gain.setValueAtTime( vol, t );
		g.gain.exponentialRampToValueAtTime( 0.0001, t + dur );
		s.connect( f ).connect( g ).connect( this.master );
		s.start( t, Math.random() * 0.3 );
		s.stop( t + dur + 0.05 );

	}

	pop() {

		this.tone( 500 + Math.random() * 500, 0.14, { slide: 140, vol: 0.35 } );

	}

	boing() {

		const f = 160 + Math.random() * 60;
		this.tone( f, 0.5, { type: 'triangle', slide: f * 3.2, vol: 0.3 } );
		this.tone( f * 2, 0.35, { slide: f * 1.2, vol: 0.12, when: 0.08 } );

	}

	chime() {

		const root = Math.floor( Math.random() * 3 );
		[ 0, 2, 4, 5 ].forEach( ( k, i ) => this.tone( noteHz( PENTA[ root + k ] ), 0.9, { type: 'triangle', vol: 0.16, when: i * 0.07 } ) );

	}

	plant() {

		this.tone( 280, 0.28, { slide: 1100, vol: 0.22, type: 'sine' } );
		this.tone( noteHz( PENTA[ 6 + Math.floor( Math.random() * 4 ) ] ), 0.6, { type: 'triangle', vol: 0.12, when: 0.18 } );

	}

	splash() {

		this.noiseHit( 0.45, { vol: 0.35, from: 1600, to: 300 } );
		this.tone( 220, 0.2, { slide: 90, vol: 0.2 } );

	}

	whoosh() {

		this.noiseHit( 1.0, { vol: 0.12, from: 400, to: 3000, type: 'bandpass', q: 3 } );

	}

	boom() {

		this.tone( 90, 0.9, { slide: 35, vol: 0.4 } );
		this.noiseHit( 0.8, { vol: 0.25, from: 1200, to: 120 } );
		for ( let i = 0; i < 14; i ++ ) this.noiseHit( 0.04, { vol: 0.08, from: 6000, to: 3000, type: 'highpass', when: 0.25 + Math.random() * 0.9 } );

	}

	door() {

		this.tone( 110, 0.6, { type: 'sawtooth', slide: 160, vol: 0.06 } );
		this.chime();

	}

	// Wandering pentatonic music-box melody.
	tick( dt ) {

		if ( ! this.ctx || ! this.musicOn ) return;
		this._step -= dt * this.tempo;
		if ( this._step > 0 ) return;
		this._step += 0.32;
		this._note = Math.max( 0, Math.min( PENTA.length - 1, this._note + Math.round( ( Math.random() - 0.5 ) * 4 ) ) );
		this.tone( noteHz( PENTA[ this._note ] ), 1.2, { type: 'sine', vol: 0.11 } );
		this.tone( noteHz( PENTA[ this._note ] ) * 2, 0.4, { type: 'sine', vol: 0.03 } );
		if ( Math.random() < 0.25 ) this.tone( noteHz( PENTA[ Math.max( 0, this._note - 4 ) ], 261.63 ), 1.5, { type: 'triangle', vol: 0.06 } );

	}

}

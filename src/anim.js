// Tiny animation helpers: springy squash, spins, hops and elastic growth.

const active = new Set();

const state = ( obj ) => obj.userData.anim ??= {
	baseScale: obj.scale.clone(),
	baseY: obj.position.y,
	sq: 0, sqV: 0,
	spin: 0,
	hop: - 1,
	grow: - 1, growDelay: 0,
	wobble: 0
};

export function squash( obj, strength = 1 ) {

	const s = state( obj );
	s.sqV -= 4.5 * strength;
	active.add( obj );

}

export function spin( obj, speed = 18 ) {

	state( obj ).spin += speed;
	active.add( obj );

}

export function hop( obj ) {

	const s = state( obj );
	if ( s.hop < 0 ) s.hop = 0;
	active.add( obj );

}

export function grow( obj, delay = 0 ) {

	const s = state( obj );
	s.grow = 0;
	s.growDelay = delay;
	obj.scale.setScalar( 0.0001 );
	active.add( obj );

}

const elastic = ( t ) => t >= 1 ? 1 : 1 - Math.pow( 2, - 9 * t ) * Math.cos( t * Math.PI * 4.2 );

export function updateAnims( dt ) {

	const h = Math.min( dt, 1 / 30 );

	for ( const obj of active ) {

		const s = obj.userData.anim;
		let busy = false;

		// Semi-implicit spring for squash & stretch.
		s.sqV += ( - 160 * s.sq - 7 * s.sqV ) * h;
		s.sq += s.sqV * h;
		if ( Math.abs( s.sq ) > 1e-4 || Math.abs( s.sqV ) > 1e-3 ) busy = true;
		else s.sq = s.sqV = 0;

		let k = 1;
		if ( s.grow >= 0 ) {

			if ( s.growDelay > 0 ) s.growDelay -= dt;
			else s.grow += dt / 1.1;
			k = Math.max( 0.0001, elastic( Math.min( s.grow, 1 ) ) );
			if ( s.grow >= 1 ) s.grow = - 1;
			else busy = true;

		}

		const q = Math.max( - 0.6, Math.min( 0.8, s.sq ) );
		obj.scale.set(
			s.baseScale.x * k * ( 1 - q * 0.45 ),
			s.baseScale.y * k * ( 1 + q ),
			s.baseScale.z * k * ( 1 - q * 0.45 )
		);

		if ( Math.abs( s.spin ) > 0.01 ) {

			obj.rotation.y += s.spin * dt;
			s.spin *= Math.exp( - 1.6 * dt );
			busy = true;

		}

		if ( s.hop >= 0 ) {

			s.hop += dt / 0.7;
			const t = Math.min( s.hop, 1 );
			obj.position.y = s.baseY + 4 * 2.2 * t * ( 1 - t );
			obj.rotation.y += dt * 9 * ( 1 - t );
			if ( s.hop >= 1 ) {

				s.hop = - 1;
				obj.position.y = s.baseY;
				s.sqV -= 3; // squish on landing

			}

			busy = true;

		}

		if ( ! busy ) active.delete( obj );

	}

}

import { useEffect, useRef, useState } from 'react';

export default function MascotCloud({ nx = 0, ny = 0 }) {
  const [smile, setSmile] = useState(false);
  const [taps, setTaps] = useState(0);
  const smileTimer = useRef(null);

  useEffect(() => {
    return () => {
      if (smileTimer.current) {
        window.clearTimeout(smileTimer.current);
      }
    };
  }, []);

  function handleTap() {
    if (smileTimer.current) {
      window.clearTimeout(smileTimer.current);
    }

    const nextTaps = taps + 1;

    setTaps(nextTaps);
    setSmile(true);

    smileTimer.current = window.setTimeout(() => {
      setSmile(false);
      smileTimer.current = null;
    }, 2200);
  }

  const hopClass = smile
    ? `hop ${taps % 2 ? 'hopA' : 'hopB'}`
    : 'hop';

  const lookTransform =
    `translate3d(${nx * 20}px, ${ny * 12}px, 0) ` +
    `rotateY(${nx * 38}deg) rotateX(${-ny * 22}deg)`;

  const eyeLStyle = {
    left: `${24 + nx * 6}px`,
    top: `${10 + ny * 4}px`,
  };

  const eyeRStyle = {
    left: `${87 + nx * 6}px`,
    top: `${10 + ny * 4}px`,
  };

  const eyeClass = smile ? 'm3eye happy' : 'm3eye';
  const cheekClass = smile ? 'm3cheek big' : 'm3cheek';
  const mouthClass = smile ? 'm3mouth happy' : 'm3mouth';

  return (
    <button
      className="scene"
      type="button"
      aria-label="Tap the cloud to make it smile"
      aria-pressed={smile}
      onClick={handleTap}
    >
      <div className="floor" />

      <div className="bobber">
        <div className={hopClass}>
          <div className="stage">
            <div
              className="look"
              style={{ transform: lookTransform }}
            >
              {/* Original cloud sphere arrangement */}
              <div className="s r220" style={{
                transform: 'translate3d(0px,10px,0px)'
              }} />

              <div className="s r110" style={{
                transform: 'translate3d(-12px,-88px,8px)'
              }} />

              <div className="s r90" style={{
                transform: 'translate3d(-82px,-58px,4px)'
              }} />

              <div className="s r90" style={{
                transform: 'translate3d(78px,-64px,4px)'
              }} />

              <div className="s r70" style={{
                transform: 'translate3d(-5px,-122px,-6px)'
              }} />

              <div className="s r110" style={{
                transform: 'translate3d(-100px,12px,6px)'
              }} />

              <div className="s r110" style={{
                transform: 'translate3d(102px,10px,6px)'
              }} />

              <div className="s r90" style={{
                transform: 'translate3d(-96px,72px,18px)'
              }} />

              <div className="s r90" style={{
                transform: 'translate3d(96px,70px,18px)'
              }} />

              <div className="s r110" style={{
                transform: 'translate3d(-46px,86px,26px)'
              }} />

              <div className="s r110" style={{
                transform: 'translate3d(50px,88px,26px)'
              }} />

              <div className="s r90" style={{
                transform: 'translate3d(-60px,-20px,58px)'
              }} />

              <div className="s r90" style={{
                transform: 'translate3d(64px,-24px,58px)'
              }} />

              <div className="s r70" style={{
                transform: 'translate3d(-24px,-70px,60px)'
              }} />

              <div className="s r70" style={{
                transform: 'translate3d(34px,-72px,58px)'
              }} />

              <div className="s r90" style={{
                transform: 'translate3d(-58px,62px,50px)'
              }} />

              <div className="s r90" style={{
                transform: 'translate3d(62px,62px,50px)'
              }} />

              <div className="s r70" style={{
                transform: 'translate3d(0px,100px,48px)'
              }} />

              {/* Original legs */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  transform: 'translate3d(-34px,118px,40px)',
                }}
              >
                <div className="m3leg" />
              </div>

              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  transform: 'translate3d(34px,118px,40px)',
                }}
              >
                <div
                  className="m3leg"
                  style={{ animationDelay: '-.8s' }}
                />
              </div>

              {/* Original arms */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  transform: 'translate3d(-112px,6px,34px) rotate(14deg)',
                }}
              >
                <div className="m3arm" />
              </div>

              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  transform: 'translate3d(112px,6px,34px) rotate(-14deg)',
                }}
              >
                <div
                  className="m3arm"
                  style={{ animationDelay: '-1s' }}
                />
              </div>

              {/* Original facial positioning and expressions */}
              <div
                className="face"
                style={{
                  transform: 'translate3d(0,30px,114px)',
                }}
              >
                <div
                  className={eyeClass}
                  style={eyeLStyle}
                />

                <div
                  className={eyeClass}
                  style={eyeRStyle}
                />

                <div
                  className={cheekClass}
                  style={{ left: '2px' }}
                />

                <div
                  className={cheekClass}
                  style={{ left: '90px' }}
                />

                <div className={mouthClass} />
              </div>

              {/* Original orbiting golden spheres */}
              <div className="orbit">
                <div
                  className="orb"
                  style={{
                    transform: 'translate3d(200px,-110px,0)',
                  }}
                />
              </div>

              <div
                className="orbit"
                style={{
                  animationDuration: '12s',
                  animationDelay: '-4s',
                }}
              >
                <div
                  className="orb"
                  style={{
                    transform: 'translate3d(-190px,60px,0)',
                    width: '14px',
                    height: '14px',
                    margin: '-7px',
                  }}
                />
              </div>

              <div
                className="orbit"
                style={{
                  animationDuration: '7s',
                  animationDelay: '-2s',
                }}
              >
                <div
                  className="orb"
                  style={{
                    transform: 'translate3d(170px,120px,0)',
                    width: '10px',
                    height: '10px',
                    margin: '-5px',
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Original three-heart smile interaction */}
      {smile && (
        <>
          <svg
            className="heart"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              d="M12 21C5 15.5 2 12 2 8.5A5 5 0 0 1 12 6a5 5 0 0 1 10 2.5C22 12 19 15.5 12 21z"
              fill="#ff6f91"
            />
          </svg>

          <svg
            className="heart"
            viewBox="0 0 24 24"
            aria-hidden="true"
            style={{
              marginLeft: '-60px',
              animationDelay: '.25s',
              top: '26%',
            }}
          >
            <path
              d="M12 21C5 15.5 2 12 2 8.5A5 5 0 0 1 12 6a5 5 0 0 1 10 2.5C22 12 19 15.5 12 21z"
              fill="#ffb3c6"
            />
          </svg>

          <svg
            className="heart"
            viewBox="0 0 24 24"
            aria-hidden="true"
            style={{
              marginLeft: '36px',
              animationDelay: '.5s',
              top: '24%',
            }}
          >
            <path
              d="M12 21C5 15.5 2 12 2 8.5A5 5 0 0 1 12 6a5 5 0 0 1 10 2.5C22 12 19 15.5 12 21z"
              fill="#ff8fab"
            />
          </svg>
        </>
      )}
    </button>
  );
}

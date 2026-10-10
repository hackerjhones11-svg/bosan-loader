import { TRUCK } from '../site';
import { C } from '../palette';

/**
 * Small cab-over flatbed truck in side elevation, facing +x. Rear end at
 * x = 0, ground at y = 0. The timeline moves the body and turns the wheels.
 */

const hair = { strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const, fill: 'none' };

function Wheel({ x }: { x: number }) {
  const R = TRUCK.wheelR;
  return (
    <g transform={`translate(${x} ${-R})`}>
      <g data-k="truck-wheel">
        <circle r={R} fill={C.graphite} />
        <circle r={R - 3} stroke={C.steel} {...hair} />
        <circle r={27} fill={C.steel} />
        <circle r={9} fill={C.silver} />
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const a = (i * Math.PI) / 3;
          return <circle key={i} cx={Math.cos(a) * 18} cy={Math.sin(a) * 18} r={3.2} fill={C.graphite2} />;
        })}
      </g>
    </g>
  );
}

function Guard({ x }: { x: number }) {
  const R = TRUCK.wheelR + 9;
  return (
    <path
      d={`M${x - R} ${-TRUCK.wheelR}A${R} ${R} 0 0 1 ${x + R} ${-TRUCK.wheelR}`}
      stroke={C.steelLight}
      strokeWidth={1}
      vectorEffect="non-scaling-stroke"
      fill="none"
    />
  );
}

export function Truck() {
  const [a1, a2, a3] = TRUCK.axles;
  const bedTop = TRUCK.bedTop;
  const cx = TRUCK.cabX;
  const top = TRUCK.cabTop;
  return (
    <g data-k="truck">
      <g data-k="truck-body">
        {/* chassis, tank */}
        <rect x={24} y={-86} width={770} height={20} fill={C.graphite2} />
        <rect x={430} y={-104} width={150} height={40} rx={10} fill={C.steel} />
        <path d="M440 -84H570" stroke={C.steelLight} {...hair} />
        {/* flat deck with stake pockets */}
        <rect x={0} y={bedTop} width={TRUCK.bedEnd} height={22} fill={C.silver} />
        <path
          d={`M0 ${bedTop + 22}H${TRUCK.bedEnd}` + [80, 160, 240, 320, 400, 480, 560].map((x) => `M${x} ${bedTop + 4}V${bedTop + 18}`).join('')}
          stroke={C.steel}
          {...hair}
        />
        {/* headboard */}
        <path
          d={`M${TRUCK.bedEnd - 16} ${bedTop}V-262H${TRUCK.bedEnd}V${bedTop}M${TRUCK.bedEnd - 16} -220H${TRUCK.bedEnd}M${TRUCK.bedEnd - 16} -178H${TRUCK.bedEnd}M${TRUCK.bedEnd - 16} -136H${TRUCK.bedEnd}`}
          stroke={C.lineLight}
          {...hair}
        />
        {/* exhaust stack */}
        <rect x={cx - 9} y={-300} width={6} height={200} fill={C.steel} />
        {/* cab */}
        <path
          d={`M${cx} -88V${top + 10}Q${cx} ${top} ${cx + 10} ${top}H${cx + 140}L${cx + 166} ${top + 52}L${cx + 170} -120V-88Z`}
          fill={C.silver}
        />
        <path d={`M${cx} -152H${cx + 170}V-88H${cx}Z`} fill={C.steelLight} />
        <path
          d={`M${cx + 30} ${top + 14}H${cx + 128}L${cx + 146} ${top + 64}V${top + 92}H${cx + 30}Z`}
          fill={C.glass}
        />
        <path
          d={`M${cx + 141} ${top + 6}L${cx + 163} ${top + 52}`}
          stroke={C.glass}
          strokeWidth={6}
          fill="none"
        />
        <path
          d={`M${cx + 22} ${top + 104}V-100M${cx + 150} ${top + 104}V-100M${cx + 22} ${top + 104}H${cx + 150}M${cx + 152} -128H${cx + 170}M${cx + 152} -116H${cx + 170}`}
          stroke={C.steel}
          {...hair}
        />
        <rect x={cx + 30} y={-100} width={42} height={10} fill={C.steel} />
        <rect x={cx + 158} y={-150} width={12} height={12} fill={C.silverLight} />
        {/* mirror */}
        <path d={`M${cx + 160} ${top + 40}H${cx + 186}`} stroke={C.line} {...hair} />
        <rect x={cx + 182} y={top + 26} width={8} height={34} fill={C.steel} />
        {/* bumper */}
        <rect x={cx + 156} y={-90} width={20} height={20} fill={C.graphite2} />
        <Guard x={a1} />
        <Guard x={a2} />
        <Guard x={a3} />
        <rect x={0} y={-104} width={20} height={14} fill={C.graphite2} />
      </g>
      <Wheel x={a1} />
      <Wheel x={a2} />
      <Wheel x={a3} />
    </g>
  );
}
